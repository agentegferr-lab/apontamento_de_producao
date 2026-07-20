import { numeroBr } from './numero.js'

/**
 * Soma a MATERIA-PRIMA (chapa, isopor, cola...) de todas as ordens de um dia — nao o
 * produto acabado de cada uma. `item.materiais` ja vem explodido e escalado pelo servidor
 * a partir da lista de materiais (BOM) do Nomus (ver server/materiais.js); aqui so agrupa
 * por codigo do material entre as varias ordens do dia e soma o total. Compartilhado entre
 * TelaPlanejamento.jsx (celula do dia) e ModalDetalheDia.jsx (modal do dia inteiro).
 */
export function agruparMaterial(itens) {
  const grupos = new Map()
  for (const item of itens) {
    for (const m of item.materiais ?? []) {
      const atual = grupos.get(m.codigo) ?? {
        chave: m.codigo,
        produto: m.descricao,
        unidadeMedida: m.unidadeMedida || '',
        quantidade: 0,
      }
      atual.quantidade += m.quantidade
      grupos.set(m.codigo, atual)
    }
  }
  return [...grupos.values()].sort((a, b) => a.produto.localeCompare(b.produto))
}

export function formatarDataBr(chave) {
  const [ano, mes, dia] = chave.split('-')
  return `${dia}/${mes}/${ano}`
}

/**
 * Soma o valor TOTAL do pedido de um conjunto de ordens, sem contar o mesmo pedido duas
 * vezes — `valorTotal` e do pedido inteiro (nao rateado por item, ver server/pedidos.js),
 * entao se duas ordens do mesmo dia vierem do mesmo pedido, contar as duas somaria o valor
 * do pedido em dobro. Ordens sem idPedido/valorTotal (ainda nao resolvidos, ver o lote de
 * fundo em server/pedidos.js) simplesmente nao entram na soma.
 */
export function somarValorUnico(itens) {
  const vistos = new Set()
  let total = 0
  for (const item of itens) {
    if (item.idPedido == null || item.valorTotal == null || vistos.has(item.idPedido)) continue
    vistos.add(item.idPedido)
    total += numeroBr(item.valorTotal)
  }
  return total
}
