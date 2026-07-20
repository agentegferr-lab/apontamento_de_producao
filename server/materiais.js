import { nomus } from './nomus.js'

/**
 * Explode a lista de materiais (BOM) de uma ordem ate chegar so em materia-prima real —
 * quanto de chapa, isopor, cola etc. e preciso pra produzir o que esta planejado pra um
 * dia, usado pela tela de Planejamento (ver client/src/components/TelaPlanejamento.jsx).
 *
 * NAO EXISTE endpoint que devolva isso pronto: sondado contra o Nomus real em 2026-07-20,
 * so existe /componentesListaMateriais?query=produtoPai.id=N (componentes DIRETOS de um
 * produto, com a quantidade necessaria por unidade). Quando um componente e ele mesmo um
 * "produto fantasma" (semi-acabado com sua propria lista de materiais), descemos
 * recursivamente ate achar so materia-prima de verdade.
 */

const PROFUNDIDADE_MAXIMA = 6 // trava de seguranca contra ciclo/erro de cadastro na BOM
const PAUSA_ENTRE_PRODUTOS_MS = 150 // mesma licao do avalanche de 429 em pedidos.js

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

function numero(valor) {
  if (valor == null || valor === '') return 0
  const limpo = String(valor).trim().replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : 0
}

/**
 * So considera a lista de materiais PADRAO e componentes NAO alternativos — um produto
 * pode ter mais de uma receita cadastrada (ou um componente com substituto), e somar as
 * duas dobraria a conta de material.
 */
async function explodirReceita(idProduto, multiplicador, acumulado, profundidade, deps) {
  if (profundidade > PROFUNDIDADE_MAXIMA || multiplicador <= 0) return
  const componentes = await deps.componentesDeProduto(idProduto)

  for (const c of componentes) {
    if (c.alternativo) continue
    if (c.listaMateriais && c.listaMateriais.padrao === false) continue
    const comp = c.produtoComponente
    if (!comp) continue

    const qtdeBase = numero(c.listaMateriais?.qtdeBase) || 1
    const quantidade = (numero(c.qtdeNecessaria) / qtdeBase) * multiplicador

    if (comp.produtoFantasma) {
      await explodirReceita(comp.id, quantidade, acumulado, profundidade + 1, deps)
      continue
    }

    const produto = await deps.produtoPorId(comp.id)
    const atual = acumulado.get(comp.codigo) ?? {
      codigo: comp.codigo,
      descricao: comp.descricao,
      unidadeMedida: produto?.siglaUnidadeMedida ?? '',
      quantidade: 0,
    }
    atual.quantidade += quantidade
    acumulado.set(comp.codigo, atual)
  }
}

/** Materia-prima necessaria pra produzir 1 unidade de `idProduto` — a "receita unitaria". */
async function receitaUnitaria(idProduto, deps) {
  const acumulado = new Map()
  await explodirReceita(Number(idProduto), 1, acumulado, 0, deps)
  return [...acumulado.values()]
}

/**
 * Anexa `materiais` (lista de materia-prima, ja escalada pela `quantidade` de cada item)
 * a cada item de planejamento recebido. Resolve a receita unitaria UMA VEZ por produto
 * distinto (varios itens do mesmo produto reaproveitam), com uma pausa entre produtos
 * NOVOS pra nao martelar o Nomus quando o cache ainda esta frio.
 *
 * `deps` (default: o `nomus` de verdade) e injetavel pra testar a explosao da BOM sem
 * chamada de rede nenhuma — ver server/materiais.test.js.
 */
export async function materiaisParaItens(itens, deps = nomus) {
  const distintos = [...new Set(itens.map((i) => i.idProduto).filter((id) => id != null))]
  const receitaPorProduto = new Map()

  for (const [i, idProduto] of distintos.entries()) {
    if (i > 0) await dormir(PAUSA_ENTRE_PRODUTOS_MS)
    try {
      receitaPorProduto.set(idProduto, await receitaUnitaria(idProduto, deps))
    } catch (erro) {
      console.warn(`[materiais] falha ao explodir a lista de materiais do produto ${idProduto}: ${erro.message}`)
      receitaPorProduto.set(idProduto, null)
    }
  }

  return itens.map((item) => {
    const receita = item.idProduto == null ? null : receitaPorProduto.get(item.idProduto)
    if (!receita) return { ...item, materiais: [] }
    const fator = numero(item.quantidade)
    const materiais = receita
      .map((m) => ({ ...m, quantidade: m.quantidade * fator }))
      .sort((a, b) => a.descricao.localeCompare(b.descricao))
    return { ...item, materiais }
  })
}
