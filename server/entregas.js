import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { AppError } from './erros.js'
import { REGEX_DATA } from './planejamento.js'
import { motoristas } from './motoristas.js'
import { caminhoes } from './caminhoes.js'

/**
 * Lancamentos de entrega (motorista registra quais pedidos entregou) — mesmo padrao JSON
 * local de server/pedidosOcultos.js. Um registro por PEDIDO entregue, nao por "viagem": um
 * motorista que entrega 5 pedidos numa saida so lanca uma vez na tela (ver POST /api/entregas),
 * mas isso vira 5 linhas aqui — deixa o relatorio (contar/agrupar por dia, motorista, caminhao)
 * trivial, sem precisar explodir array aninhado depois. Cada pedido pode trazer metragem/
 * valor/cliente junto (todos opcionais, digitados pelo motorista — nao vem do Nomus).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_ENTREGAS
  ? path.resolve(process.env.ARQUIVO_ENTREGAS)
  : path.join(__dirname, '..', 'dados', 'entregas.json')

let itens = []

function carregar() {
  try {
    const bruto = fs.readFileSync(ARQUIVO, 'utf8')
    const dados = JSON.parse(bruto)
    itens = Array.isArray(dados) ? dados : []
    console.log(`[entregas] ${itens.length} lancamento(s) de entrega recuperado(s)`)
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.error(`[entregas] ARQUIVO ILEGIVEL (${ARQUIVO}) — subindo vazio:`, erro.message)
    }
    itens = []
  }
}

function gravar() {
  const temporario = `${ARQUIVO}.tmp`
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
  fs.writeFileSync(temporario, JSON.stringify(itens, null, 2), 'utf8')
  fs.renameSync(temporario, ARQUIVO)
}

carregar()

function normalizarNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

/**
 * Um item de `pedidos` pode vir como string solta ("PD 01038", formato antigo) ou como
 * objeto com os campos extras — os dois viram o mesmo formato aqui. `metragem`/`valor` sao
 * numeros comuns (nao o formato BR "1.234,56" do Nomus — este campo e digitado pelo
 * motorista num <input type="number">, nao vem do Nomus). Devolve `null` se nao tiver
 * pedido, pra quem chama filtrar fora.
 */
function normalizarItemPedido(item) {
  const bruto = typeof item === 'string' ? { pedido: item } : (item ?? {})
  const pedido = String(bruto.pedido ?? '').trim()
  if (!pedido) return null
  return {
    pedido,
    metragem: normalizarNumero(bruto.metragem),
    valor: normalizarNumero(bruto.valor),
    cliente: String(bruto.cliente ?? '').trim() || null,
  }
}

/** Parte pura: valida e normaliza o payload de lancamento, sem tocar no array/disco — dá pra
 * testar sem mockar fs. Lanca AppError no primeiro problema. */
export function validarLancamento({ motoristaId, caminhaoId, data, pedidos }, { buscarMotorista, buscarCaminhao }) {
  const motorista = buscarMotorista(motoristaId)
  if (!motorista) throw new AppError('Motorista nao encontrado.', 400)
  if (!motorista.ativo) throw new AppError('Motorista esta inativo.', 400)

  const caminhao = buscarCaminhao(caminhaoId)
  if (!caminhao) throw new AppError('Caminhao nao encontrado.', 400)
  if (!caminhao.ativo) throw new AppError('Caminhao esta inativo.', 400)

  if (!REGEX_DATA.test(data ?? '')) throw new AppError('data precisa estar no formato AAAA-MM-DD.', 400)

  const itensNormalizados = (Array.isArray(pedidos) ? pedidos : []).map(normalizarItemPedido).filter(Boolean)
  if (itensNormalizados.length === 0) throw new AppError('Informe ao menos um pedido entregue.', 400)

  return { motoristaId, caminhaoId, data, pedidos: itensNormalizados }
}

export const entregas = {
  listar() {
    return [...itens]
  },

  /** Cria um registro por pedido informado, todos com o mesmo motorista/caminhao/data. */
  lancar(payload) {
    const valido = validarLancamento(payload, {
      buscarMotorista: (id) => motoristas.obter(id),
      buscarCaminhao: (id) => caminhoes.obter(id),
    })

    const criadoEm = new Date().toISOString()
    const novos = valido.pedidos.map((item) => ({
      id: crypto.randomUUID(),
      motoristaId: valido.motoristaId,
      caminhaoId: valido.caminhaoId,
      pedido: item.pedido,
      metragem: item.metragem,
      valor: item.valor,
      cliente: item.cliente,
      data: valido.data,
      criadoEm,
    }))

    itens.push(...novos)
    gravar()
    return novos
  },

  /** Remove um lancamento (um pedido) por id — mesmo padrao de planejamento.remover(): so
   * grava se de fato achou e removeu, devolve boolean pra rota decidir 204 ou 404. */
  remover(id) {
    const antes = itens.length
    itens = itens.filter((i) => i.id !== id)
    if (itens.length === antes) return false
    gravar()
    return true
  },
}
