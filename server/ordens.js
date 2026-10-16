import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nomus } from './nomus.js'

/**
 * Lista de ordens de producao (`/ordens`), varrida por JANELAS DE ID em vez de paginar por
 * posicao.
 *
 * INCIDENTE (2026-10-16): ordens novas ficavam sem pedido/produto/cliente no kanban. Causa
 * raiz, confirmada contra o Nomus real: certos registros (ex.: ids 1804 e 1814) fazem o
 * Nomus responder 400 `{"status":400}` SEMPRE que a pagina em que eles caem e pedida — mesmo
 * isolados (`?query=id==1804`). Paginar por posicao (`?pagina=N`, com ou sem `query=id>X`)
 * quebra na primeira pagina que contem um desses registros, e como a varredura inteira e
 * descartada quando uma pagina falha, NADA acima daquele id jamais entrava na lista. As
 * janelas `id>=A;id<B` de 50 ids cabem numa pagina so (ids sao unicos), e quando uma janela
 * volta 400 ela e dividida ao meio ate isolar o id ruim, que e pulado (e lembrado, pra nao
 * repetir a busca) — o resto da janela entra normalmente.
 *
 * O progresso (maior id varrido) e as ordens ficam em disco: a primeira varredura completa
 * custa dezenas de chamadas, as seguintes so olham os ids novos (mais uma revisao dos
 * ultimos ids, pra pegar mudanca de status). Nunca bloqueia quem pediu o kanban.
 */

const ENDPOINT = () => process.env.NOMUS_ENDPOINT_ORDENS?.trim() || '/ordens'
const TAMANHO_JANELA = 50
const JANELAS_VAZIAS_PARA_PARAR = 3
const REVISAO_RETROATIVA_IDS = 100
const TTL_MS = () => Number(process.env.ORDENS_TTL_MS) || 60_000
const COOLDOWN_FALHA_MS = 60_000
const REVERIFICAR_RUIM_MS = 24 * 60 * 60 * 1000
const PAUSA_ENTRE_JANELAS_MS = 150
const RUINS_RESOLVIDOS_POR_CICLO = 6

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ORDENS_CACHE_FILE
  ? path.resolve(process.env.ORDENS_CACHE_FILE)
  : path.join(__dirname, '..', 'dados', 'cache-ordens.json')

/** So o que o resto do servidor le de uma ordem — o registro cru do Nomus e bem maior. */
export function compactarOrdem(o) {
  return {
    id: o.id,
    nome: o.nome ?? null,
    idProduto: o.idProduto ?? null,
    descricaoProduto: o.descricaoProduto ?? null,
    codigoProduto: o.codigoProduto ?? null,
    qtde: o.qtde ?? null,
    unidadeMedida: o.unidadeMedida ?? null,
    status: o.status ?? null,
    dataHoraCriacao: o.dataHoraCriacao ?? null,
    itensPedido: (o.itensPedido ?? []).map((i) => ({
      idPedido: i.idPedido ?? null,
      item: i.item ?? null,
      nomeCliente: i.nomeCliente ?? null,
    })),
  }
}

const estado = {
  ordens: new Map(), // id -> ordem compacta
  varridoAte: 0, // maior id ja olhado (com ou sem ordem)
  ruins: new Map(), // id -> quando o Nomus recusou (400) pela ultima vez
  pedidosDosRuins: new Map(), // id ruim -> { idPedido: number|null, quando } (ver resolverPedidoDoRuim)
  atualizadoEm: 0,
  proximaTentativaEm: 0,
  emVoo: null,
  prioridade: new Set(), // ids de ordens que o kanban mostra agora (ver ordensConhecidas)
}

function carregar() {
  try {
    const bruto = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'))
    for (const o of bruto.ordens ?? []) estado.ordens.set(Number(o.id), o)
    estado.varridoAte = Number(bruto.varridoAte) || 0
    for (const [id, quando] of Object.entries(bruto.ruins ?? {})) estado.ruins.set(Number(id), quando)
    estado.atualizadoEm = Number(bruto.atualizadoEm) || 0
    for (const [id, r] of Object.entries(bruto.pedidosDosRuins ?? {})) estado.pedidosDosRuins.set(Number(id), r)
    console.log(`[ordens] ${estado.ordens.size} ordem(ns) restaurada(s) do disco (varrido ate o id ${estado.varridoAte})`)
    return
  } catch (erro) {
    if (erro.code !== 'ENOENT') console.warn('[ordens] cache em disco ilegivel, comecando do cache antigo:', erro.message)
  }
  // Primeira subida depois desta mudanca: aproveita a lista antiga de /ordens (cache do
  // nomus.js) pra nao comecar do zero. Ela e contigua do id mais baixo ate onde a paginacao
  // por posicao aguentou.
  // Inclui as listas "id>N" que o codigo antigo cacheava (ordens recentes): sem elas, as OS
  // ativas (ids altos) ficariam sem pedido ate a varredura nova alcanca-las.
  for (const antiga of nomus.espiarCachePorPrefixo(`lista:${ENDPOINT()}`)) {
    if (!Array.isArray(antiga)) continue
    for (const o of antiga) {
      const id = Number(o?.id ?? o?.idOrdem)
      if (Number.isFinite(id)) estado.ordens.set(id, compactarOrdem({ ...o, id }))
    }
  }
  if (estado.ordens.size) {
    estado.varridoAte = Math.max(0, ...estado.ordens.keys())
    console.log(`[ordens] ${estado.ordens.size} ordem(ns) aproveitada(s) do cache antigo (ate o id ${estado.varridoAte})`)
  }
}
carregar()

function persistir() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
    const temporario = `${ARQUIVO}.tmp`
    fs.writeFileSync(
      temporario,
      JSON.stringify({
        varridoAte: estado.varridoAte,
        atualizadoEm: estado.atualizadoEm,
        ruins: Object.fromEntries(estado.ruins),
        pedidosDosRuins: Object.fromEntries(estado.pedidosDosRuins),
        ordens: [...estado.ordens.values()],
      }),
      'utf8',
    )
    fs.renameSync(temporario, ARQUIVO)
  } catch (erro) {
    console.warn('[ordens] falha ao gravar cache em disco:', erro.message)
  }
}

/**
 * Ordens com id em [de, ate). Uma chamada so quando a janela esta sana; se o Nomus devolver
 * 400, divide ao meio ate isolar o(s) id(s) ruim(ns), que entram em `ruins` e sao pulados.
 * `buscar(de, ate)` e injetavel pra teste; `agora` tambem.
 */
export async function buscarJanela(de, ate, buscar, ruins, agora = Date.now) {
  if (ate <= de) return []

  // Pula ruins conhecidos sem gastar chamada: busca so os trechos entre eles.
  const conhecidos = [...ruins.keys()]
    .filter((id) => id >= de && id < ate && agora() - ruins.get(id) < REVERIFICAR_RUIM_MS)
    .sort((a, b) => a - b)
  if (conhecidos.length) {
    const achadas = []
    let inicio = de
    for (const id of conhecidos) {
      achadas.push(...(await buscarJanela(inicio, id, buscar, ruins, agora)))
      inicio = id + 1
    }
    achadas.push(...(await buscarJanela(inicio, ate, buscar, ruins, agora)))
    return achadas
  }

  try {
    return await buscar(de, ate)
  } catch (erro) {
    if (erro?.status !== 400) throw erro
    if (ate - de <= 1) {
      ruins.set(de, agora())
      return []
    }
    const meio = Math.floor((de + ate) / 2)
    return [
      ...(await buscarJanela(de, meio, buscar, ruins, agora)),
      ...(await buscarJanela(meio, ate, buscar, ruins, agora)),
    ]
  }
}

/**
 * Pedido de uma ordem que o Nomus NAO consegue devolver (400). Nao da pra ler o registro,
 * mas da pra perguntar "essa ordem tem item de pedido com id de pedido em [a, b)?": se tiver,
 * o Nomus tenta serializar a ordem e responde 400; se nao tiver, a ordem nem entra na
 * resposta (200, lista vazia). Bisseccionando a faixa, achamos o id do pedido em ~12 chamadas.
 * Confirmado contra o Nomus real em 2026-10-16 (ordens 1804, 1814, 1823, 1855).
 * `dentroDaFaixa(id, a, b)` -> true se 400, false se 200; qualquer outro erro sobe.
 * Devolve o id do pedido, ou null se a ordem nao tem pedido na faixa [menor, maior).
 */
export async function resolverPedidoDoRuim(id, menor, maior, dentroDaFaixa) {
  if (!(await dentroDaFaixa(id, menor, maior))) return null
  let lo = menor
  let hi = maior
  while (hi - lo > 1) {
    const meio = Math.floor((lo + hi) / 2)
    if (await dentroDaFaixa(id, lo, meio)) hi = meio
    else lo = meio
  }
  return lo
}

async function dentroDaFaixaNoNomus(id, a, b) {
  try {
    await nomus.consultaSemCache(ENDPOINT(), {
      query: `id==${id};itensPedido.pedido.id>=${a};itensPedido.pedido.id<${b}`,
      pagina: 1,
    })
    return false
  } catch (erro) {
    if (erro?.status === 400) return true
    throw erro
  }
}

async function resolverPedidosDosRuins() {
  const maiorPedido = Math.max(
    1,
    ...[...estado.ordens.values()].flatMap((o) => o.itensPedido.map((i) => Number(i.idPedido) || 0)),
  )
  let feitos = 0
  const ordemDeTrabalho = [...estado.ruins.keys()].sort(
    (x, y) => Number(estado.prioridade.has(y)) - Number(estado.prioridade.has(x)) || y - x,
  )
  for (const id of ordemDeTrabalho) {
    if (feitos >= RUINS_RESOLVIDOS_POR_CICLO) break
    const antes = estado.pedidosDosRuins.get(id)
    if (antes && (antes.idPedido != null || Date.now() - antes.quando < REVERIFICAR_RUIM_MS)) continue
    feitos++
    const idPedido = await resolverPedidoDoRuim(id, 1, maiorPedido + 500, dentroDaFaixaNoNomus)
    estado.pedidosDosRuins.set(id, { idPedido, quando: Date.now() })
    persistir()
    console.log(`[ordens] ordem ${id} (ilegivel no Nomus) -> ${idPedido != null ? `pedido id ${idPedido}` : 'sem pedido encontrado'}`)
  }
}

const buscarNoNomus = (de, ate) =>
  nomus.consultaSemCache(ENDPOINT(), { query: `id>=${de};id<${ate}`, pagina: 1 })

/**
 * Ordens que o kanban mostra agora e que ainda nao se conhece: busca primeiro so as janelas
 * delas (mais novas antes), em vez de esperar a varredura continua chegar la. Nao mexe em
 * `varridoAte` — a varredura continua cobre tudo em ordem, sem buracos.
 */
async function buscarPrioritarias() {
  const faltam = [...estado.prioridade].filter(
    (id) => !estado.ordens.has(id) && estado.pedidosDosRuins.get(id)?.idPedido == null,
  )
  const janelas = [...new Set(faltam.map((id) => Math.floor(id / TAMANHO_JANELA) * TAMANHO_JANELA))].sort((x, y) => y - x)
  for (const inicio of janelas) {
    const lista = await buscarJanela(inicio, inicio + TAMANHO_JANELA, buscarNoNomus, estado.ruins)
    for (const o of lista) {
      const id = Number(o?.id ?? o?.idOrdem)
      if (Number.isFinite(id)) estado.ordens.set(id, compactarOrdem({ ...o, id }))
    }
    await dormir(PAUSA_ENTRE_JANELAS_MS)
  }
  if (janelas.length) {
    await resolverPedidosDosRuins()
    persistir()
    console.log(`[ordens] ${faltam.length} ordem(ns) do quadro buscada(s) com prioridade (${janelas.length} janela(s))`)
  }
}

async function varrer() {
  await buscarPrioritarias()
  let a = Math.max(1, estado.varridoAte - REVISAO_RETROATIVA_IDS + 1)
  const maxAntes = estado.varridoAte
  let vazias = 0
  let novas = 0
  let desdeUltimaGravacao = 0
  let janelasFeitas = 0

  while (vazias < JANELAS_VAZIAS_PARA_PARAR || a <= maxAntes) {
    const ruinsAntes = estado.ruins.size
    const lista = await buscarJanela(a, a + TAMANHO_JANELA, buscarNoNomus, estado.ruins)
    for (const o of lista) {
      const id = Number(o?.id ?? o?.idOrdem)
      if (!Number.isFinite(id)) continue
      if (!estado.ordens.has(id)) {
        novas++
        desdeUltimaGravacao++
      }
      estado.ordens.set(id, compactarOrdem({ ...o, id }))
      estado.varridoAte = Math.max(estado.varridoAte, id)
    }
    const achouRuim = estado.ruins.size > ruinsAntes
    if (achouRuim) {
      const dentro = [...estado.ruins.keys()].filter((id) => id >= a && id < a + TAMANHO_JANELA)
      estado.varridoAte = Math.max(estado.varridoAte, ...dentro)
    }
    vazias = lista.length || achouRuim ? 0 : vazias + 1
    a += TAMANHO_JANELA
    // O quadro pode ter pedido ordens novas enquanto esta varredura longa roda.
    if (++janelasFeitas % 5 === 0) await buscarPrioritarias()

    // Progresso fica em disco de tempos em tempos: uma falha (429, rede) no meio da
    // primeira varredura nao joga fora o que ja foi buscado.
    if (desdeUltimaGravacao >= 200) {
      desdeUltimaGravacao = 0
      persistir()
    }
    await dormir(PAUSA_ENTRE_JANELAS_MS)
  }

  await resolverPedidosDosRuins()
  estado.atualizadoEm = Date.now()
  persistir()
  if (novas) {
    console.log(
      `[ordens] varredura concluida: ${novas} ordem(ns) nova(s), ${estado.ordens.size} no total, ` +
        `${estado.ruins.size} id(s) recusado(s) pelo Nomus`,
    )
  }
}

function atualizarEmFundo() {
  const agora = Date.now()
  const fresco = agora - estado.atualizadoEm < TTL_MS()
  if (estado.emVoo || fresco || agora < estado.proximaTentativaEm) return
  estado.emVoo = varrer()
    .catch((erro) => {
      estado.proximaTentativaEm = Date.now() + COOLDOWN_FALHA_MS
      persistir()
      console.warn(`[ordens] varredura falhou (retoma de onde parou): ${erro.message}`)
    })
    .finally(() => {
      estado.emVoo = null
    })
}

/** Ordens que ja se conhece, na hora; dispara a atualizacao em segundo plano se vencida. */
export function ordensConhecidas(idsEmDestaque) {
  if (idsEmDestaque) estado.prioridade = new Set([...idsEmDestaque].map(Number).filter(Number.isFinite))
  atualizarEmFundo()
  const lista = [...estado.ordens.values()]
  // Ordens que o Nomus nao devolve (400) entram so com o vinculo de pedido descoberto por
  // resolverPedidoDoRuim — sem produto/quantidade, mas com pedido (que e o que nao pode faltar).
  for (const [id, r] of estado.pedidosDosRuins) {
    if (r.idPedido == null || estado.ordens.has(id)) continue
    lista.push({
      id,
      nome: null,
      idProduto: null,
      descricaoProduto: null,
      codigoProduto: null,
      qtde: null,
      unidadeMedida: null,
      status: null,
      dataHoraCriacao: null,
      itensPedido: [{ idPedido: r.idPedido, item: null, nomeCliente: null }],
    })
  }
  return lista
}

export function forcarOrdens() {
  estado.atualizadoEm = 0
  estado.proximaTentativaEm = 0
}

export function ultimaAtualizacaoDasOrdens() {
  return estado.atualizadoEm ? new Date(estado.atualizadoEm) : null
}

/**
 * Por que uma ordem esta (ou nao) com pedido — pro diagnostico (GET /api/diagnostico/vinculos).
 *  desconhecida          a varredura ainda nao chegou nela (vai entrar sozinha)
 *  recusada-pedido-pendente  o Nomus nao devolve o registro e o pedido ainda nao foi descoberto
 *  recusada-sem-pedido   idem, mas a busca concluiu: a ordem nao tem pedido no Nomus
 *  sem-itens-de-pedido   o Nomus devolveu a ordem e ela realmente nao tem item de pedido
 *  conhecida             tem idPedido (o codigo do pedido pode estar so pendente de busca)
 */
export function situacaoDaOrdem(id) {
  const ordem = estado.ordens.get(id)
  if (ordem) return ordem.itensPedido?.[0]?.idPedido ? 'conhecida' : 'sem-itens-de-pedido'
  const r = estado.pedidosDosRuins.get(id)
  if (r) return r.idPedido != null ? 'conhecida' : 'recusada-sem-pedido'
  if (estado.ruins.has(id)) return 'recusada-pedido-pendente'
  return 'desconhecida'
}

export function idsRecusadosPeloNomus() {
  return [...estado.ruins.keys()].sort((x, y) => x - y)
}
