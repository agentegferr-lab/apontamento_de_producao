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
