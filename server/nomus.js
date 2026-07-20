import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'

export class NomusError extends Error {
  constructor(mensagem, { status, corpo, retryAfterMs } = {}) {
    super(mensagem)
    this.name = 'NomusError'
    this.status = status ?? 502
    this.corpo = corpo
    this.retryAfterMs = retryAfterMs
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * O Nomus responde 429 com um campo `tempoAteLiberar`, mas a documentacao nao diz a
 * unidade. Numeros pequenos so fazem sentido como segundos (2 = 2s, nao 2ms), numeros
 * grandes so fazem sentido como milissegundos. O corte em 300 separa os dois casos:
 * uma espera legitima em segundos nao passa de alguns minutos.
 */
function normalizarEspera(valor) {
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0) return null
  return n <= 300 ? n * 1000 : n
}

function extrairRetryAfter(corpo, headers) {
  const doCorpo = normalizarEspera(corpo?.tempoAteLiberar)
  if (doCorpo) return doCorpo

  const header = headers?.get?.('retry-after')
  if (header) {
    const segundos = Number(header)
    if (Number.isFinite(segundos)) return segundos * 1000
    const data = Date.parse(header)
    if (Number.isFinite(data)) return Math.max(0, data - Date.now())
  }
  return null
}

async function lerCorpo(resposta) {
  const texto = await resposta.text()
  if (!texto) return null
  try {
    return JSON.parse(texto)
  } catch {
    return texto
  }
}

/**
 * Extrai uma mensagem legivel do corpo de erro do Nomus pra logar/mostrar ao operador.
 * O formato do corpo varia por endpoint (string solta, {mensagem}, {message}, lista de
 * erros de validacao) — sem isso, um corpo em formato inesperado virava um erro generico
 * tipo "Nomus retornou 406 em POST /apontamentos" sem dizer POR QUE, dificultando o
 * diagnostico (foi o caso do 406 com quantidade produzida, 2026-07-16).
 */
function extrairDetalheErro(corpo) {
  if (!corpo) return ''
  if (typeof corpo === 'string') return `: ${corpo}`
  if (Array.isArray(corpo)) return corpo.length ? `: ${JSON.stringify(corpo)}` : ''
  const texto = corpo.mensagem || corpo.message || corpo.erro || corpo.error
  if (texto) return `: ${texto}`
  try {
    const bruto = JSON.stringify(corpo)
    return bruto && bruto !== '{}' ? `: ${bruto}` : ''
  } catch {
    return ''
  }
}

function montarUrl(caminho, query) {
  const url = new URL(config.baseUrl + caminho)
  for (const [chave, valor] of Object.entries(query ?? {})) {
    if (valor !== undefined && valor !== null && valor !== '') {
      url.searchParams.set(chave, String(valor))
    }
  }
  return url
}

/**
 * Uma requisicao ao Nomus, com retry apenas para 429 (throttling).
 * Nao ha retry para 5xx: um POST /apontamentos que falhou por erro do servidor pode ter
 * sido gravado, e reenviar duplicaria o apontamento. Quem decide retentar e o operador.
 */
async function requisitar(metodo, caminho, { query, body, maxTentativas } = {}) {
  const url = montarUrl(caminho, query)
  const tentativasPermitidas = maxTentativas ?? config.maxTentativasThrottle

  for (let tentativa = 1; ; tentativa++) {
    let resposta
    try {
      resposta = await fetch(url, {
        method: metodo,
        headers: {
          Authorization: `Basic ${config.credencialBasic}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    } catch (erro) {
      const timeout = erro.name === 'TimeoutError' || erro.name === 'AbortError'
      throw new NomusError(
        timeout
          ? `Nomus nao respondeu em ${config.timeoutMs}ms (${metodo} ${caminho})`
          : `Falha de rede ao chamar o Nomus (${metodo} ${caminho}): ${erro.message}`,
        { status: timeout ? 504 : 502 },
      )
    }

    const corpo = await lerCorpo(resposta)

    if (resposta.status === 429) {
      const esperaMs = extrairRetryAfter(corpo, resposta.headers) ?? 2000
      const podeRetentar = tentativa <= tentativasPermitidas && esperaMs <= config.maxEsperaThrottleMs

      if (!podeRetentar) {
        throw new NomusError('Nomus esta limitando as requisicoes (429). Tente novamente.', {
          status: 429,
          corpo,
          retryAfterMs: esperaMs,
        })
      }
      console.warn(
        `[nomus] 429 em ${metodo} ${caminho} - aguardando ${esperaMs}ms (tentativa ${tentativa}/${tentativasPermitidas})`,
      )
      await dormir(esperaMs)
      continue
    }

    if (resposta.status === 401 || resposta.status === 403) {
      throw new NomusError('Chave de integracao do Nomus rejeitada (verifique NOMUS_API_KEY).', {
        status: 502, // nao repassa 401 pro browser: o problema e do servidor, nao do operador
        corpo,
      })
    }

    if (resposta.status === 404) {
      throw new NomusError(`Nomus retornou 404 em ${metodo} ${caminho}`, { status: 404, corpo })
    }

    if (!resposta.ok) {
      throw new NomusError(
        `Nomus retornou ${resposta.status} em ${metodo} ${caminho}${extrairDetalheErro(corpo)}`,
        { status: resposta.status, corpo },
      )
    }

    return corpo
  }
}

const comoLista = (v) => (Array.isArray(v) ? v : v?.content ?? v?.lista ?? v?.dados ?? [])

/**
 * CONFIRMADO contra o Nomus real (2026-07-15, comparando com um projeto irmao que ja
 * integra com o mesmo Nomus/mesma empresa havia dias): endpoints de lista paginam em
 * SILENCIO, sempre 50 registros por pagina, via `?pagina=N` comecando em 1 — sem
 * metadados de pagina na resposta e sem avisar que ha mais paginas. Um GET sem esse
 * parametro so devolve a pagina 1. Isto e o que fazia o resolver nao achar ordens/
 * operacoes que nao estivessem entre os ~50 registros mais recentes.
 *
 * So termina quando uma pagina vem MAIS CURTA que o tamanho de pagina — a mesma
 * heuristica usada no projeto irmao. Uma pausa de 300ms entre paginas evita martelar
 * o Nomus (que ja throttlou em 429 durante o desenvolvimento).
 */
async function requisitarPaginado(caminho, { query, tamanhoPagina = 50 } = {}) {
  const itens = []
  for (let pagina = 1; ; pagina++) {
    if (pagina > 1) await dormir(300)
    const dados = comoLista(await requisitar('GET', caminho, { query: { ...query, pagina } }))
    itens.push(...dados)
    if (dados.length < tamanhoPagina) break
  }
  return itens
}

// --- Cache para dados de cadastro e para o roteiro/apontamentos completos -----------
// Ler tudo paginado e caro (dezenas de paginas): o TTL e alto de proposito, seguindo o
// mesmo valor validado por um projeto irmao que ja roda contra este mesmo Nomus.
//
// INCIDENTE (2026-07-15): varios restarts do servidor durante testes zeraram este cache
// (so vivia em memoria) repetidas vezes, forcando uma varredura completa cara a cada
// restart — em cima de uma API ja sob rate limit, isso deixou o kanban sem carregar por um
// bom tempo. Duas mudancas:
//   1. O cache agora persiste em DISCO — sobrevive a um restart do processo.
//   2. Quando existe um valor no cache mas ele esta VENCIDO, devolve o valor antigo NA HORA
//      e atualiza em segundo plano (stale-while-revalidate) — quem pediu nunca fica
//      esperando uma varredura inteira so porque o TTL passou ou o servidor reiniciou. So
//      espera de verdade na PRIMEIRA vez, quando nao ha nada em cache (nem em disco).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO_CACHE = process.env.ARQUIVO_CACHE_NOMUS
  ? path.resolve(process.env.ARQUIVO_CACHE_NOMUS)
  : path.join(__dirname, '..', 'dados', 'cache-nomus.json')

const cache = new Map()

try {
  const bruto = JSON.parse(fs.readFileSync(ARQUIVO_CACHE, 'utf8'))
  for (const [chave, entrada] of Object.entries(bruto)) cache.set(chave, entrada)
  console.log(`[nomus] cache restaurado do disco: ${cache.size} entrada(s)`)
} catch (erro) {
  if (erro.code !== 'ENOENT') console.warn('[nomus] cache em disco ilegivel, comecando vazio:', erro.message)
}

let gravacaoAgendada = false
function persistirCache() {
  if (gravacaoAgendada) return // varias atualizacoes seguidas viram uma gravacao so
  gravacaoAgendada = true
  setImmediate(() => {
    gravacaoAgendada = false
    try {
      const paraGravar = {}
      for (const [chave, entrada] of cache.entries()) {
        // nunca grava a promise em voo/atualizacao de fundo, so o valor ja resolvido
        if (entrada.valor !== undefined) paraGravar[chave] = { valor: entrada.valor, expiraEm: entrada.expiraEm }
      }
      fs.mkdirSync(path.dirname(ARQUIVO_CACHE), { recursive: true })
      const temporario = `${ARQUIVO_CACHE}.tmp`
      fs.writeFileSync(temporario, JSON.stringify(paraGravar), 'utf8')
      fs.renameSync(temporario, ARQUIVO_CACHE)
    } catch (erro) {
      console.warn('[nomus] falha ao persistir cache em disco:', erro.message)
    }
  })
}

async function comCache(chave, produtor, ttlMsOverride) {
  const agora = Date.now()
  const entrada = cache.get(chave)

  // Fresco: devolve na hora.
  if (entrada && entrada.valor !== undefined && entrada.expiraEm > agora) return entrada.valor

  // Vencido, mas existe um valor (do disco ou de antes): devolve o valor velho JA e
  // atualiza em segundo plano, sem bloquear quem pediu. So um refresh de fundo por vez.
  if (entrada && entrada.valor !== undefined) {
    if (!entrada.atualizandoEmFundo) {
      const emFundo = produtor()
        .then((valor) => {
          cache.set(chave, { valor, expiraEm: Date.now() + (ttlMsOverride ?? config.cacheTtlMs) })
          persistirCache()
        })
        .catch((erro) => {
          console.warn(`[nomus] atualizacao em segundo plano de "${chave}" falhou, mantendo dado anterior: ${erro.message}`)
          const atual = cache.get(chave)
          if (atual) cache.set(chave, { ...atual, atualizandoEmFundo: null })
        })
      cache.set(chave, { ...entrada, atualizandoEmFundo: emFundo })
    }
    return entrada.valor
  }

  // Nada em cache (nem em disco): so aqui espera de verdade. Compartilha a promise em
  // voo — varias leituras simultaneas na largada viram uma chamada so.
  if (entrada?.emVoo) return entrada.emVoo

  const emVoo = produtor()
    .then((valor) => {
      cache.set(chave, { valor, expiraEm: Date.now() + (ttlMsOverride ?? config.cacheTtlMs) })
      persistirCache()
      return valor
    })
    .catch((erro) => {
      cache.delete(chave)
      throw erro
    })

  cache.set(chave, { emVoo })
  return emVoo
}

export function limparCache() {
  cache.clear()
  persistirCache()
}

export const nomus = {
  async funcionarioPorMatricula(matricula) {
    return comCache(`funcionario:${matricula}`, async () => {
      // Paginado por seguranca: uma empresa com mais de 50 funcionarios ativos faria uma
      // busca sem paginacao nunca achar quem estiver fora da 1a pagina.
      const lista = await requisitarPaginado('/funcionarios', { query: { matricula } })
      return lista.find((f) => String(f.matricula) === String(matricula)) ?? null
    })
  },

  async recursos() {
    return comCache('recursos', async () => requisitarPaginado('/recursos'))
  },

  async atividades(idRecurso) {
    return comCache(`atividades:${idRecurso}`, async () =>
      requisitarPaginado('/atividades', { query: { idRecurso } }),
    )
  },

  /**
   * Roteiro completo, paginado ate o fim e cacheado — e a base do kanban e do resolver de
   * etiqueta. TTL alto (config.cacheTtlMs) porque uma varredura completa custa dezenas de
   * paginas; ver server/config.js.
   */
  async todasOperacoes() {
    return comCache('operacoes:todas', () => requisitarPaginado('/operacoesRoteiroOrdem'))
  },

  /**
   * GET paginado com cache, pra endpoints cujo formato de lista o app so descobre em tempo
   * de execucao (ex.: /ordens, usado em pedidos.js pro vinculo do numero do pedido).
   * Cacheado por caminho, entao servir endpoints diferentes nao colide.
   */
  async listaGenerica(caminho) {
    return comCache(`lista:${caminho}`, () => requisitarPaginado(caminho))
  },

  /**
   * Busca UM registro por id, sem paginar (usado por /pedidos, que aceita busca direta por
   * id mas cuja listagem completa tem milhares de registros e e fortemente limitada por
   * rate limit — nunca listar /pedidos inteiro). ttlMs default bem mais longo: pedido
   * raramente muda depois de criado.
   *
   * `maxTentativas` baixo (default 1, sem retry) porque quem chama isto em lote (ex.:
   * pedidos.js resolvendo centenas de ordens) trata uma falha como "tenta de novo no
   * proximo ciclo de cache", nao como erro fatal — insistir 3x por item, sem essa opcao,
   * foi o que transformou um 429 isolado numa avalanche (ver historico).
   */
  async porId(caminho, id, { ttlMs = 24 * 60 * 60 * 1000, maxTentativas = 1 } = {}) {
    return comCache(
      `porId:${caminho}:${id}`,
      () => requisitar('GET', `${caminho}/${id}`, { maxTentativas }),
      ttlMs,
    )
  },

  /**
   * Um produto por id (dados comerciais/fiscais — inclui `siglaUnidadeMedida`, que a lista
   * de materiais abaixo nao devolve por componente). TTL longo: um produto quase nao muda.
   */
  async produtoPorId(idProduto) {
    return nomus.porId('/produtos', idProduto)
  },

  /**
   * Componentes da lista de materiais (BOM) de UM produto pai — CONFIRMADO contra o Nomus
   * real em 2026-07-20 (endpoint "Lista de materiais" / "Componentes da lista de
   * materiais" da documentacao Nomus): GET /componentesListaMateriais?query=produtoPai.id=N
   * devolve os componentes diretos (materia-prima ou semi-acabado) e a quantidade
   * necessaria de cada um pra produzir `listaMateriais.qtdeBase` unidades do pai. Um
   * componente com `produtoComponente.produtoFantasma=true` e ele mesmo uma lista de
   * materiais (semi-acabado) — quem consome isto precisa descer recursivamente (ver
   * server/materiais.js). TTL longo: uma receita de produto quase nunca muda.
   */
  async componentesDeProduto(idProduto) {
    return comCache(
      `componentesListaMateriais:${idProduto}`,
      () => requisitarPaginado('/componentesListaMateriais', { query: { query: `produtoPai.id=${idProduto}` } }),
      24 * 60 * 60 * 1000,
    )
  },

  /** O que ja foi gravado no Nomus. Define quais etapas contam como concluidas. */
  async apontamentos() {
    return comCache('apontamentos', () => requisitarPaginado('/apontamentos'))
  },

  async criarApontamento(payload) {
    const criado = await requisitar('POST', '/apontamentos', { body: payload })
    // Sem isto o kanban continuaria mostrando a etapa como pendente ate o cache vencer, e
    // o card so andaria de coluna so depois do TTL longo do cache paginado.
    cache.delete('apontamentos')
    return criado
  },
}
