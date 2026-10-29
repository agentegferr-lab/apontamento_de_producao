import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nomus } from './nomus.js'
import { normalizarPedido } from './pedidosOcultos.js'

/**
 * Material de cada pedido (telha sanduiche, telha simples, parafuso...) pra coluna "Material"
 * da tela de Entregas. Vem dos ITENS do pedido no Nomus (`/pedidos` -> itensPedido[].idProduto
 * -> `/produtos/{id}`.descricao), nao das ordens de producao: parafuso e outros itens
 * revendidos nao tem OS, mas estao no pedido.
 *
 * Resolvido em segundo plano e guardado em disco (dados/cache-materiais-pedido.json): os
 * itens de um pedido ja lancado praticamente nao mudam, entao cada pedido custa umas poucas
 * chamadas ao Nomus UMA vez so. A tela mostra "—" ate resolver e se atualiza sozinha.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_MATERIAIS_PEDIDO
  ? path.resolve(process.env.ARQUIVO_MATERIAIS_PEDIDO)
  : path.join(__dirname, '..', 'dados', 'cache-materiais-pedido.json')

const semAcento = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()

// A PRIMEIRA regra que casar vence — das mais especificas pras mais gerais. Texto ja sem acento.
const REGRAS = [
  // Parafuso PRIMEIRO: a descricao de parafuso de costura cita "(TELHA/TELHA)" e cairia em Telha.
  [/PARAFUSO/, 'Parafuso'],
  [/TELHA\s+SEMI\s*-?\s*SAND/, 'Telha semi sanduíche'],
  [/TELHA\s+SAND|SANDUICHE/, 'Telha sanduíche'],
  [/TELHA\s+FORRO|FORRO\s+METALICO/, 'Telha forro'],
  [/TELHA\s+SIMPLES/, 'Telha simples'],
  [/TELHA\s+ONDULADA/, 'Telha ondulada'],
  [/TELHA\s+TRANSLUCIDA/, 'Telha translúcida'],
  [/TELHA/, 'Telha'],
  [/CUMIEIRA|CUMEEIRA/, 'Cumeeira'],
  [/CALHA|RUFO|PINGADEIRA|BOCAL|ACABAMENTO/, 'Calha / rufo'],
  [/FORRO\s+(PVC|CHAPA)|^FORRO/, 'Forro'],
  [/METALON/, 'Metalon'],
  [/VIGA\s+U/, 'Viga U'],
  [/TELA\s+SOLD/, 'Tela soldada'],
  [/VERGALHAO/, 'Vergalhão'],
  [/TRELICA/, 'Treliça'],
  [/TINTA/, 'Tinta'],
  [/\bEPS\b/, 'EPS'],
  [/PORTA/, 'Porta'],
  [/BOBINA/, 'Bobina'],
  [/FRETE|MAO\s+DE\s+OBRA|SERVICO/, 'Serviço'],
]

/** Descricao de produto do Nomus -> categoria curta pra exibir ("Outros" quando nao reconhece). */
export function categorizarMaterial(descricao) {
  const t = semAcento(descricao)
  for (const [regra, categoria] of REGRAS) if (regra.test(t)) return categoria
  return 'Outros'
}

/** Descricoes dos itens -> { categorias (sem repetir, na ordem do pedido), itens }. */
export function resumirMateriais(descricoes) {
  const itens = (descricoes ?? [])
    .filter((d) => d != null && String(d).trim() !== '')
    .map((descricao) => ({ descricao: String(descricao).trim(), categoria: categorizarMaterial(descricao) }))
  return { categorias: [...new Set(itens.map((i) => i.categoria))], itens }
}

/** "2019" / "PD 02019" / "pd02019" -> chave "2019" (mesma normalizacao dos pedidos ocultos). */
export const chaveDoPedido = normalizarPedido

const cache = new Map() // chave -> { categorias, itens, em }
try {
  for (const [chave, v] of Object.entries(JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')))) cache.set(chave, v)
  console.log(`[materiais] ${cache.size} pedido(s) com material resolvido(s) restaurado(s) do disco`)
} catch (erro) {
  if (erro.code !== 'ENOENT') console.warn('[materiais] cache em disco ilegivel, comecando vazio:', erro.message)
}

let gravacaoAgendada = false
function persistir() {
  if (gravacaoAgendada) return
  gravacaoAgendada = true
  const timer = setTimeout(() => {
    gravacaoAgendada = false
    try {
      fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
      const temporario = `${ARQUIVO}.tmp`
      fs.writeFileSync(temporario, JSON.stringify(Object.fromEntries(cache)), 'utf8')
      fs.renameSync(temporario, ARQUIVO)
    } catch (erro) {
      console.warn('[materiais] falha ao gravar cache em disco:', erro.message)
    }
  }, 1000)
  timer.unref?.()
}

/** Material ja resolvido do pedido, ou null (ainda nao resolvido). */
export function materiaisConhecidos(pedido) {
  const chave = chaveDoPedido(pedido)
  return chave ? (cache.get(chave) ?? null) : null
}

const COOLDOWN_FALHA_MS = 5 * 60 * 1000
const COOLDOWN_NAO_ENCONTRADO_MS = 60 * 60 * 1000
const PAUSA_ENTRE_PEDIDOS_MS = 400
const proximaTentativa = new Map() // chave -> quando pode tentar de novo
const fila = new Set()
let rodando = null

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function resolverPedido(chave) {
  const codigo = `PD ${chave.padStart(5, '0')}`
  const encontrados = await nomus.consultaSemCache('/pedidos', { query: `codigoPedido=="${codigo}"`, pagina: 1 })
  const pedido = encontrados[0]
  if (!pedido) {
    proximaTentativa.set(chave, Date.now() + COOLDOWN_NAO_ENCONTRADO_MS)
    return
  }
  const descricoes = []
  for (const item of pedido.itensPedido ?? []) {
    if (item?.idProduto == null) continue
    const produto = await nomus.produtoPorId(item.idProduto)
    descricoes.push(produto?.descricao ?? produto?.nome ?? null)
  }
  cache.set(chave, { ...resumirMateriais(descricoes), em: Date.now() })
  persistir()
}

async function processarFila() {
  while (fila.size > 0) {
    const chave = fila.values().next().value
    fila.delete(chave)
    try {
      await resolverPedido(chave)
    } catch (erro) {
      proximaTentativa.set(chave, Date.now() + COOLDOWN_FALHA_MS)
      console.warn(`[materiais] pedido ${chave}: ${erro.message}`)
    }
    await dormir(PAUSA_ENTRE_PEDIDOS_MS)
  }
}

/** Enfileira, em segundo plano, os pedidos que ainda nao tem material resolvido. Nunca espera. */
export function pedirMateriais(pedidos) {
  for (const pedido of pedidos ?? []) {
    const chave = chaveDoPedido(pedido)
    if (!chave || cache.has(chave) || fila.has(chave)) continue
    if ((proximaTentativa.get(chave) ?? 0) > Date.now()) continue
    fila.add(chave)
  }
  if (fila.size > 0 && !rodando) {
    rodando = processarFila()
      .catch((erro) => console.warn('[materiais] fila falhou:', erro.message))
      .finally(() => {
        rodando = null
      })
  }
}
