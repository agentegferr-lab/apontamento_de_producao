import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Lista de pedidos escondidos do kanban de acompanhamento, por pedido manual do usuario
 * (ex.: pedido cancelado, duplicado, ou que nunca deveria ter entrado em producao). E so
 * nosso, nunca vai pro Nomus — mesmo padrao de server/planejamento.js e server/andamento.js.
 * Reversivel: ocultar so tira da tela, nao apaga nada no Nomus nem no cache de pedidos.
 *
 * Guarda o CODIGO do pedido normalizado (so digitos, sem zero a esquerda — "PD 01038" ou
 * "1038" viram "1038"), nao o idPedido interno: e o numero que o usuario ve e informa,
 * disponivel assim que o card aparece no kanban (ver server/kanban.js).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_PEDIDOS_OCULTOS
  ? path.resolve(process.env.ARQUIVO_PEDIDOS_OCULTOS)
  : path.join(__dirname, '..', 'dados', 'pedidos-ocultos.json')

let itens = []

function carregar() {
  try {
    const bruto = fs.readFileSync(ARQUIVO, 'utf8')
    const dados = JSON.parse(bruto)
    itens = Array.isArray(dados) ? dados : []
    console.log(`[pedidos-ocultos] ${itens.length} pedido(s) oculto(s) recuperado(s)`)
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.error(`[pedidos-ocultos] ARQUIVO ILEGIVEL (${ARQUIVO}) — subindo vazio:`, erro.message)
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

/** "PD 01038", "01038" ou 1038 todos viram "1038" — usado pra comparar card.pedido com a lista. */
export function normalizarPedido(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '')
  const semZeros = digitos.replace(/^0+(?=\d)/, '')
  return semZeros || null
}

export const pedidosOcultos = {
  listar() {
    return [...itens]
  },

  /** Set de codigos normalizados, pronto pro filtro em server/kanban.js. */
  codigos() {
    return new Set(itens.map((i) => i.codigo))
  },

  /** Idempotente: ocultar o mesmo pedido de novo so devolve o registro ja existente. */
  ocultar(pedidoTexto) {
    const codigo = normalizarPedido(pedidoTexto)
    if (!codigo) return null
    const existente = itens.find((i) => i.codigo === codigo)
    if (existente) return existente

    const registro = { codigo, rotulo: String(pedidoTexto).trim(), ocultadoEm: new Date().toISOString() }
    itens.push(registro)
    gravar()
    return registro
  },

  /** Volta a mostrar (aceita o codigo normalizado ou qualquer forma equivalente, ex. "PD 01038"). */
  mostrar(pedidoTextoOuCodigo) {
    const codigo = normalizarPedido(pedidoTextoOuCodigo)
    const antes = itens.length
    itens = itens.filter((i) => i.codigo !== codigo)
    if (itens.length !== antes) gravar()
    return antes !== itens.length
  },
}
