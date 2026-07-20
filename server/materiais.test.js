import test from 'node:test'
import assert from 'node:assert/strict'
import { materiaisParaItens } from './materiais.js'

/**
 * Fake de `nomus` — so os dois metodos que materiais.js usa. Formato dos registros
 * confirmado contra o Nomus real (GET /componentesListaMateriais?query=produtoPai.id=N),
 * ver server/nomus.js.
 */
function fakeNomus({ componentesPorProduto = {}, produtos = {} }) {
  return {
    async componentesDeProduto(idProduto) {
      return componentesPorProduto[idProduto] ?? []
    },
    async produtoPorId(idProduto) {
      return produtos[idProduto] ?? null
    },
  }
}

test('explode a BOM direta e escala pela quantidade do item', async () => {
  const deps = fakeNomus({
    componentesPorProduto: {
      1150: [
        {
          alternativo: false,
          listaMateriais: { padrao: true, qtdeBase: '1' },
          qtdeNecessaria: '1',
          produtoComponente: { id: 493, codigo: '0491', descricao: 'EPS 30MM', produtoFantasma: false },
        },
        {
          alternativo: false,
          listaMateriais: { padrao: true, qtdeBase: '1' },
          qtdeNecessaria: '0,2',
          produtoComponente: { id: 617, codigo: '0615', descricao: 'COLA PARA TELHA', produtoFantasma: false },
        },
      ],
    },
    produtos: {
      493: { siglaUnidadeMedida: 'UNID' },
      617: { siglaUnidadeMedida: 'KG' },
    },
  })

  const [item] = await materiaisParaItens([{ idProduto: 1150, quantidade: '10' }], deps)

  assert.deepEqual(
    item.materiais.map((m) => ({ codigo: m.codigo, unidadeMedida: m.unidadeMedida, quantidade: m.quantidade })),
    [
      { codigo: '0615', unidadeMedida: 'KG', quantidade: 2 }, // 0,2 * 10
      { codigo: '0491', unidadeMedida: 'UNID', quantidade: 10 }, // 1 * 10
    ],
  )
})

test('ignora componentes alternativos e listas de materiais nao-padrao', async () => {
  const deps = fakeNomus({
    componentesPorProduto: {
      1: [
        {
          alternativo: true, // substituto — nao deve entrar na conta
          listaMateriais: { padrao: true, qtdeBase: '1' },
          qtdeNecessaria: '5',
          produtoComponente: { id: 900, codigo: 'ALT', descricao: 'SUBSTITUTO', produtoFantasma: false },
        },
        {
          alternativo: false,
          listaMateriais: { padrao: false, qtdeBase: '1' }, // receita nao-padrao — nao deve entrar
          qtdeNecessaria: '5',
          produtoComponente: { id: 901, codigo: 'ALTRECEITA', descricao: 'OUTRA RECEITA', produtoFantasma: false },
        },
        {
          alternativo: false,
          listaMateriais: { padrao: true, qtdeBase: '1' },
          qtdeNecessaria: '3',
          produtoComponente: { id: 902, codigo: 'REAL', descricao: 'MATERIAL DE VERDADE', produtoFantasma: false },
        },
      ],
    },
    produtos: { 902: { siglaUnidadeMedida: 'M2' } },
  })

  const [item] = await materiaisParaItens([{ idProduto: 1, quantidade: '1' }], deps)
  assert.deepEqual(item.materiais.map((m) => m.codigo), ['REAL'])
})

test('desce recursivamente por componente "fantasma" (semi-acabado) ate materia-prima real', async () => {
  const deps = fakeNomus({
    componentesPorProduto: {
      // produto acabado -> 2x do semi-acabado "fantasma"
      10: [
        {
          alternativo: false,
          listaMateriais: { padrao: true, qtdeBase: '1' },
          qtdeNecessaria: '2',
          produtoComponente: { id: 20, codigo: 'SEMI', descricao: 'SEMI-ACABADO', produtoFantasma: true },
        },
      ],
      // semi-acabado -> 3x de materia-prima real por unidade dele
      20: [
        {
          alternativo: false,
          listaMateriais: { padrao: true, qtdeBase: '1' },
          qtdeNecessaria: '3',
          produtoComponente: { id: 30, codigo: 'MP', descricao: 'MATERIA PRIMA', produtoFantasma: false },
        },
      ],
    },
    produtos: { 30: { siglaUnidadeMedida: 'KG' } },
  })

  // 1 unidade do produto acabado -> 2 do semi-acabado -> 2*3=6 de materia-prima
  const [item] = await materiaisParaItens([{ idProduto: 10, quantidade: '1' }], deps)
  assert.deepEqual(item.materiais, [{ codigo: 'MP', descricao: 'MATERIA PRIMA', unidadeMedida: 'KG', quantidade: 6 }])
})

test('varios itens do mesmo produto reaproveitam a mesma receita unitaria', async () => {
  let chamadas = 0
  const deps = {
    async componentesDeProduto(idProduto) {
      chamadas++
      return [
        {
          alternativo: false,
          listaMateriais: { padrao: true, qtdeBase: '1' },
          qtdeNecessaria: '1',
          produtoComponente: { id: 1, codigo: 'X', descricao: 'X', produtoFantasma: false },
        },
      ]
    },
    async produtoPorId() {
      return { siglaUnidadeMedida: 'UNID' }
    },
  }

  const resultado = await materiaisParaItens(
    [
      { idProduto: 5, quantidade: '2' },
      { idProduto: 5, quantidade: '3' },
    ],
    deps,
  )
  assert.equal(chamadas, 1) // um produto distinto so, mesmo com 2 itens
  assert.equal(resultado[0].materiais[0].quantidade, 2)
  assert.equal(resultado[1].materiais[0].quantidade, 3)
})

test('item sem idProduto, ou produto sem receita encontrada, devolve materiais vazio sem quebrar', async () => {
  const deps = fakeNomus({})
  const resultado = await materiaisParaItens(
    [{ idProduto: null, quantidade: '10' }, { idProduto: 999, quantidade: '10' }],
    deps,
  )
  assert.deepEqual(resultado[0].materiais, [])
  assert.deepEqual(resultado[1].materiais, [])
})

test('falha ao buscar a BOM de um produto nao quebra os outros itens', async () => {
  const deps = {
    async componentesDeProduto(idProduto) {
      if (idProduto === 1) throw new Error('Nomus fora do ar')
      return [
        {
          alternativo: false,
          listaMateriais: { padrao: true, qtdeBase: '1' },
          qtdeNecessaria: '1',
          produtoComponente: { id: 1, codigo: 'X', descricao: 'X', produtoFantasma: false },
        },
      ]
    },
    async produtoPorId() {
      return { siglaUnidadeMedida: 'UNID' }
    },
  }

  const resultado = await materiaisParaItens(
    [
      { idProduto: 1, quantidade: '10' },
      { idProduto: 2, quantidade: '10' },
    ],
    deps,
  )
  assert.deepEqual(resultado[0].materiais, [])
  assert.equal(resultado[1].materiais[0].quantidade, 10)
})
