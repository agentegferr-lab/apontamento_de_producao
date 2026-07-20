import test from 'node:test'
import assert from 'node:assert/strict'
import { entradaPedido } from './pedidos.js'

// Formato confirmado contra o Nomus real em 2026-07-15.
const item = { id: 2717, idPedido: 1279, item: '00010', nomeCliente: 'CESAR EDUARDO' }
const pedido = { id: 1279, codigoPedido: 'PD 01294' }

const CAMPOS_VAZIOS = {
  idProduto: null,
  produto: null,
  codigoProduto: null,
  quantidade: null,
  unidadeMedida: null,
  statusOrdem: null,
}

test('monta a entrada [idOrdem, {pedido, idPedido, ...camposOrdem, statusItemPedido, valorTotal}] a partir do item, do pedido resolvido e dos campos da ordem', () => {
  const entrada = entradaPedido(1579, item, { ...pedido, valorTotal: '1.805,61' }, undefined, {
    idProduto: 8,
    produto: 'TELHA SANDUICHE TR40',
    codigoProduto: '0006',
    quantidade: '1.287,64',
    unidadeMedida: 'M2',
    statusOrdem: 'Liberada',
  })
  assert.deepEqual(entrada, [
    1579,
    {
      pedido: 'PD 01294',
      idPedido: 1279,
      idProduto: 8,
      produto: 'TELHA SANDUICHE TR40',
      codigoProduto: '0006',
      quantidade: '1.287,64',
      unidadeMedida: 'M2',
      statusOrdem: 'Liberada',
      statusItemPedido: null,
      valorTotal: '1.805,61',
    },
  ])
})

test('sem camposOrdem informado, todos os campos da ordem ficam null', () => {
  const entrada = entradaPedido(1579, item, pedido)
  assert.equal(entrada[1].idProduto, null)
  assert.equal(entrada[1].produto, null)
  assert.equal(entrada[1].codigoProduto, null)
  assert.equal(entrada[1].quantidade, null)
  assert.equal(entrada[1].unidadeMedida, null)
  assert.equal(entrada[1].statusOrdem, null)
})

test('valorTotal e do pedido inteiro (nao do item), null se o pedido nao tiver o campo', () => {
  assert.equal(entradaPedido(1579, item, { ...pedido, valorTotal: '1.805,61' })[1].valorTotal, '1.805,61')
  assert.equal(entradaPedido(1579, item, pedido)[1].valorTotal, null)
})

test('statusItemPedido casa pelo campo `item` (ex. "00010") dentro de pedido.itensPedido', () => {
  const pedidoComItens = {
    ...pedido,
    itensPedido: [
      { item: '00010', status: 2 },
      { item: '00020', status: 1 },
    ],
  }
  const entradaA = entradaPedido(1579, item, pedidoComItens) // item.item === '00010'
  assert.equal(entradaA[1].statusItemPedido, 2)

  const outroItem = { ...item, item: '00020' }
  const entradaB = entradaPedido(1579, outroItem, pedidoComItens)
  assert.equal(entradaB[1].statusItemPedido, 1)
})

test('sem item de pedido, nao gera entrada', () => {
  assert.equal(entradaPedido(1579, undefined, pedido), null)
  assert.equal(entradaPedido(1579, {}, pedido), null)
})

test('sem idOrdem, nao gera entrada', () => {
  assert.equal(entradaPedido(null, item, pedido), null)
  assert.equal(entradaPedido(undefined, item, pedido), null)
})

test('pedido nao resolvido (sem o campo esperado, ou nulo): gera entrada com pedido/statusItemPedido null mas idPedido presente, nao quebra', () => {
  // camposOrdem/idPedido nao dependem do pedido ter resolvido — a entrada existe do mesmo
  // jeito, so `pedido` (texto) e `statusItemPedido` ficam null ate o lote de fundo achar o
  // pedido (statusItemPedido PRECISA do pedido resolvido, diferente dos campos da ordem).
  assert.deepEqual(entradaPedido(1579, item, { id: 1279 }), [
    1579,
    { pedido: null, idPedido: 1279, ...CAMPOS_VAZIOS, statusItemPedido: null, valorTotal: null },
  ])
  assert.deepEqual(entradaPedido(1579, item, null), [
    1579,
    { pedido: null, idPedido: 1279, ...CAMPOS_VAZIOS, statusItemPedido: null, valorTotal: null },
  ])
})

test('campo do pedido e configuravel (NOMUS_CAMPO_PEDIDO)', () => {
  const entrada = entradaPedido(1579, item, { numeroPedido: 'PV-2026-0431' }, 'numeroPedido')
  assert.deepEqual(entrada, [
    1579,
    { pedido: 'PV-2026-0431', idPedido: 1279, ...CAMPOS_VAZIOS, statusItemPedido: null, valorTotal: null },
  ])
})
