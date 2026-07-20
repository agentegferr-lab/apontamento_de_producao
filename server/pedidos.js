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
 * Status do ITEM de pedido de venda (numero cru do Nomus). Confirmado contra o Nomus real
 * em 2026-07-18 (telas "Pedidos de venda", filtro "Status do item de pedido"):
 *   1 = Aguardando liberacao   (confirmado com PD 01320 e PD 01319 reais)
 *   2 = Liberado               (inferido: e o grupo dominante — 332 de 396 itens da GFERRO
 *                                no nosso cache — condizente com "maioria ja liberada";
 *                                NAO temos um exemplo real confirmado desse codigo ainda)
 * Os demais codigos vistos (4, 6, ...) nao foram decifrados — provavelmente
 * Faturado/Entregue/Cancelado ou similar. So usar pra filtro de "aguardando ou liberado".
 */
export const STATUS_ITEM_PEDIDO = {
  AGUARDANDO_LIBERACAO: 1,
  LIBERADO: 2,
}

/**
 * Parte pura: dado UM item de itensPedido, decide a entrada do mapa. Separada do loop com
 * I/O pra dar pra testar sem mockar rede/disco.
 *
 * `camposOrdem` (idProduto, produto, codigoProduto, quantidade, unidadeMedida, statusOrdem) vem de
 * campos da PROPRIA ordem (nao do pedido) — nao custam chamada extra ao Nomus, e por isso
 * NAO dependem do pedido ja ter resolvido: a entrada sempre existe com eles prontos, mesmo
 * que `pedido` ainda esteja null esperando o lote de fundo. Antes esses campos ficavam
 * presos atras da resolucao do pedido (que pode levar varios ciclos numa empresa grande) —
 * isso deixava a maioria dos cards sem produto/status por um bom tempo, e um KPI que
 * dependa de statusOrdem (ver TelaKanban.jsx) contava quase tudo errado.
 *
 * `quantidade`/`unidadeMedida` vem cru do Nomus (ex. "1.287,64", separador de milhar com
 * ponto e decimal com virgula) — quem soma/formata e o cliente (ver client/src/numero.js).
 *
 * `statusOrdem` e o status de requisicao de material da ORDEM (Planejada/Confirmada/
 * Liberada/...) — nao tem nada a ver com o status de PRODUCAO (EM_PRODUCAO/AGUARDANDO/...)
 * calculado pelo kanban, NEM com `statusItemPedido` abaixo (que e do PEDIDO DE VENDA).
 *
 * `statusItemPedido` e `valorTotal` PRECISAM do pedido resolvido (vivem no proprio objeto
 * `pedido`, nao na ordem) — ao contrario dos campos de `camposOrdem`, ficam null ate o lote
 * de fundo achar esse pedido especifico. `statusItemPedido` casa pelo campo `item` (ex.
 * "00010"), que identifica QUAL item do pedido esta ordem representa — um pedido pode ter
 * itens em status diferentes. `valorTotal` e do PEDIDO INTEIRO (nao so do item desta OS) —
 * se o pedido tiver mais de um item/OS, o mesmo valor aparece em cada uma; escolhido assim
 * de proposito (mais simples que ratear por item) a pedido do usuario.
 */
export function entradaPedido(idOrdem, item, pedido, campoPedido = 'codigoPedido', camposOrdem = {}) {
  if (!item?.idPedido || idOrdem == null) return null
  const codigo = pedido?.[campoPedido]
  const pedidoResolvido = codigo == null || codigo === '' ? null : String(codigo)
  const itemPedido = pedido?.itensPedido?.find((ip) => ip.item === item.item)
  return [
    Number(idOrdem),
    {
      pedido: pedidoResolvido,
      // id interno do pedido no Nomus — vem direto de itensPedido[0], nunca precisa de
      // busca nenhuma. Use isto (nao o `pedido` textual acima) pra agrupar/deduplicar por
      // pedido sem depender da resolucao lenta do codigo (ver kanban.js / TelaKanban.jsx).
      idPedido: Number(item.idPedido),
      idProduto: camposOrdem.idProduto ?? null,
      produto: camposOrdem.produto ?? null,
      codigoProduto: camposOrdem.codigoProduto ?? null,
      quantidade: camposOrdem.quantidade ?? null,
      unidadeMedida: camposOrdem.unidadeMedida ?? null,
      statusOrdem: camposOrdem.statusOrdem ?? null,
      statusItemPedido: itemPedido?.status ?? null,
      // Cru do Nomus (ex. "1.805,61" — ponto de milhar, virgula decimal), igual quantidade.
      valorTotal: pedido?.valorTotal ?? null,
    },
  ]
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

  // produto/statusOrdem vem da propria ordem — sempre entram no mapa na hora, mesmo que o
  // codigo do pedido ainda nao esteja em cache (ele so preenche depois, via lote de fundo).
  // NUNCA espera uma busca nova ao Nomus aqui.
  for (const ordem of ordens) {
    const item = ordem?.itensPedido?.[0]
    const idOrdem = ordem?.id ?? ordem?.idOrdem
    if (!item?.idPedido || idOrdem == null) continue

    const chave = String(item.idPedido)
    const emCache = cache.get(chave)
    const valido = emCache && Date.now() - emCache.buscadoEm < TTL_CACHE_MS()

    const entrada = entradaPedido(idOrdem, item, valido ? emCache.pedido : null, campoPedido, {
      idProduto: ordem?.idProduto ?? null,
      produto: ordem?.descricaoProduto ?? null,
      codigoProduto: ordem?.codigoProduto ?? null,
      quantidade: ordem?.qtde ?? null,
      unidadeMedida: ordem?.unidadeMedida ?? null,
      statusOrdem: ordem?.status ?? null,
    })
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
