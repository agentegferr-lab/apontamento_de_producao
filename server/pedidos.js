import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nomus, NomusError } from './nomus.js'

/**
 * Vincula cada ordem ao seu numero de pedido (e ao nome do cliente).
 *
 * CONFIRMADO contra o Nomus real em 2026-07-15 (comparado com um projeto irmao que ja
 * integra com o mesmo Nomus ha dias): o vinculo e um cruzamento em duas etapas:
 *
 *   GET /ordens[].itensPedido[0]   = { idPedido, nomeCliente, item }
 *   GET /pedidos/{idPedido}        = { id, codigoPedido, ... }   <- busca por UM id, direto
 *
 * `/pedidos` (sem id) tem MILHARES de registros e e fortemente limitado por rate limit —
 * o projeto irmao documenta 429 em quase toda chamada de pedido individual. Por isso:
 *   1. NUNCA listar /pedidos inteiro (paginar tudo levaria minutos e martelaria o Nomus).
 *   2. So buscar, um de cada vez, os pedidos que ordens REAIS referenciam.
 *   3. Cachear cada pedido em DISCO com TTL longo (pedido praticamente nao muda depois de
 *      criado) — sem isso, todo restart do servidor rebuscaria tudo de novo e tomaria 429.
 *
 * INCIDENTE (2026-07-15): a primeira versao buscava TODOS os pedidos referenciados numa
 * unica chamada, sem pausa entre eles e com ate 3 tentativas por item em 429 — com uma
 * empresa de ~880 ordens (muitos pedidos distintos, cache frio no 1o boot), isso martelou
 * o Nomus com centenas de chamadas em sequencia e virou uma avalanche de 429 que consumiu
 * a cota compartilhada da chave, deixando ATE o Iniciar (que nem usa isto) lento. Corrigido
 * com pausa entre chamadas novas, sem retry (pedido e "bonus": se falhar agora, o proximo
 * ciclo tenta de novo) e um teto de quantos pedidos NOVOS busca por chamada — o resto so
 * aparece nos cards depois, conforme o cache vai esquentando ao longo de varios ciclos.
 */

const ENDPOINT_ORDENS = () => process.env.NOMUS_ENDPOINT_ORDENS?.trim() || '/ordens'
const ENDPOINT_PEDIDOS = () => process.env.NOMUS_ENDPOINT_PEDIDOS?.trim() || '/pedidos'
const CAMPO_PEDIDO = () => process.env.NOMUS_CAMPO_PEDIDO?.trim() || 'codigoPedido'
const TTL_CACHE_MS = () => Number(process.env.PEDIDO_CACHE_TTL_MS) || 24 * 60 * 60 * 1000 // 24h
const PAUSA_ENTRE_CHAMADAS_MS = () => Number(process.env.PEDIDO_PAUSA_MS) || 250
const MAX_NOVOS_POR_CHAMADA = () => Number(process.env.PEDIDO_MAX_NOVOS_POR_CICLO) || 20

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO_CACHE = process.env.PEDIDO_CACHE_FILE
  ? path.resolve(process.env.PEDIDO_CACHE_FILE)
  : path.join(__dirname, '..', 'dados', 'cache-pedidos.json')

let cache = new Map()
try {
  const bruto = JSON.parse(fs.readFileSync(ARQUIVO_CACHE, 'utf8'))
  cache = new Map(Object.entries(bruto))
} catch (erro) {
  if (erro.code !== 'ENOENT') console.warn('[pedidos] cache em disco ilegivel, comecando vazio:', erro.message)
}

function persistirCache() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO_CACHE), { recursive: true })
    const temporario = `${ARQUIVO_CACHE}.tmp`
    fs.writeFileSync(temporario, JSON.stringify(Object.fromEntries(cache)), 'utf8')
    fs.renameSync(temporario, ARQUIVO_CACHE)
  } catch (erro) {
    console.warn('[pedidos] falha ao gravar cache de pedidos em disco:', erro.message)
  }
}

let avisouIndisponivel = false
function avisarUmaVez(mensagem) {
  if (avisouIndisponivel) return
  avisouIndisponivel = true
  console.warn(`[pedidos] ${mensagem}`)
}

/** Busca um pedido, usando o cache em disco antes de bater na Nomus. Sem retry (ver topo). */
async function buscarPedido(idPedido) {
  const pedido = await nomus.porId(ENDPOINT_PEDIDOS(), idPedido, { ttlMs: TTL_CACHE_MS(), maxTentativas: 1 })
  cache.set(String(idPedido), { pedido, buscadoEm: Date.now() })
  return pedido
}

/**
 * Parte pura: dado UM item de itensPedido (ja resolvido pra um pedido carregado), decide
 * a entrada do mapa. Separada do loop com I/O pra dar pra testar sem mockar rede/disco.
 *
 * `produto` vem de `descricaoProduto`, um campo da propria ordem (nao do pedido) — nao
 * custa chamada extra ao Nomus, so passa direto pelo cruzamento existente.
 */
export function entradaPedido(idOrdem, item, pedido, campoPedido = 'codigoPedido', produto = null) {
  if (!item?.idPedido || idOrdem == null) return null
  const codigo = pedido?.[campoPedido]
  if (codigo == null || codigo === '') return null
  return [Number(idOrdem), { pedido: String(codigo), produto: produto ?? null }]
}

let atualizandoEmFundo = null

export async function mapaPedidosPorOrdem() {
  let ordens
  try {
    ordens = await nomus.listaGenerica(ENDPOINT_ORDENS())
  } catch (erro) {
    const naoExiste = erro instanceof NomusError && erro.status === 404
    avisarUmaVez(
      naoExiste
        ? `${ENDPOINT_ORDENS()} nao existe nesta API. Os cards ficam sem o pedido. ` +
            `Rode "node ferramentas/diagnostico.js" e ajuste NOMUS_ENDPOINT_ORDENS no .env.`
        : `falha ao ler ${ENDPOINT_ORDENS()}: ${erro.message}. Cards seguem sem o pedido.`,
    )
    return new Map()
  }

  const campoPedido = CAMPO_PEDIDO()
  const mapa = new Map()

  // So usa o que JA esta em cache — nunca espera uma busca nova ao Nomus aqui. Ordem sem
  // pedido cacheado ainda fica sem "Pedido"/produto no card desta vez, e aparece sozinha
  // assim que o lote de fundo abaixo resolver ela.
  for (const ordem of ordens) {
    const item = ordem?.itensPedido?.[0]
    const idOrdem = ordem?.id ?? ordem?.idOrdem
    if (!item?.idPedido || idOrdem == null) continue

    const chave = String(item.idPedido)
    const emCache = cache.get(chave)
    const valido = emCache && Date.now() - emCache.buscadoEm < TTL_CACHE_MS()
    if (!valido) continue

    const entrada = entradaPedido(idOrdem, item, emCache.pedido, campoPedido, ordem?.descricaoProduto ?? null)
    if (entrada) mapa.set(...entrada)
  }

  agendarAtualizacaoEmFundo(ordens)
  return mapa
}

/**
 * Busca pedidos novos (nao cacheados) em segundo plano, sem bloquear quem pediu o kanban.
 *
 * INCIDENTE (2026-07-17): essa busca rodava DENTRO de mapaPedidosPorOrdem, no meio da
 * requisicao do /api/kanban — com o Nomus sob rate limit (429 recorrente), esperar ate 20
 * buscas novas sequenciais (cada uma podendo levar ate ~30s de backoff) segurava a resposta
 * por 40+ segundos. Rodar em segundo plano tira o kanban dessa espera: a tela carrega com o
 * que ja esta em cache na hora, e os pedidos que faltam vao preenchendo nas atualizacoes
 * seguintes. So um lote de fundo por vez (chamadas concorrentes ao kanban nao empilham
 * lotes); o proximo lote so comeca quando o anterior termina.
 */
function agendarAtualizacaoEmFundo(ordens) {
  if (atualizandoEmFundo) return

  const maxNovos = MAX_NOVOS_POR_CHAMADA()
  const pausaMs = PAUSA_ENTRE_CHAMADAS_MS()

  atualizandoEmFundo = (async () => {
    let mudou = false
    let novosBuscados = 0

    for (const ordem of ordens) {
      if (novosBuscados >= maxNovos) break

      const item = ordem?.itensPedido?.[0]
      if (!item?.idPedido) continue

      const chave = String(item.idPedido)
      const emCache = cache.get(chave)
      const valido = emCache && Date.now() - emCache.buscadoEm < TTL_CACHE_MS()
      if (valido) continue

      if (novosBuscados > 0) await dormir(pausaMs)
      novosBuscados++

      try {
        await buscarPedido(item.idPedido)
        mudou = true
      } catch (erro) {
        console.warn(`[pedidos] falha ao buscar pedido ${item.idPedido}: ${erro.message}`)
      }
    }

    if (mudou) persistirCache()
  })()
    .catch((erro) => console.warn('[pedidos] lote de fundo falhou:', erro.message))
    .finally(() => {
      atualizandoEmFundo = null
    })
}
