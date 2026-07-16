import test from 'node:test'
import assert from 'node:assert/strict'
import { entradaPedido } from './pedidos.js'

// Formato confirmado contra o Nomus real em 2026-07-15.
const item = { id: 2717, idPedido: 1279, item: '00010', nomeCliente: 'CESAR EDUARDO' }
const pedido = { id: 1279, codigoPedido: 'PD 01294' }

test('monta a entrada [idOrdem, {pedido, produto}] a partir do item, do pedido resolvido e do produto', () => {
  const entrada = entradaPedido(1579, item, pedido, undefined, 'TELHA SANDUICHE TR40')
  assert.deepEqual(entrada, [1579, { pedido: 'PD 01294', produto: 'TELHA SANDUICHE TR40' }])
})

test('sem produto informado, produto fica null', () => {
  const entrada = entradaPedido(1579, item, pedido)
  assert.equal(entrada[1].produto, null)
})

test('sem item de pedido, nao gera entrada', () => {
  assert.equal(entradaPedido(1579, undefined, pedido), null)
  assert.equal(entradaPedido(1579, {}, pedido), null)
})

test('sem idOrdem, nao gera entrada', () => {
  assert.equal(entradaPedido(null, item, pedido), null)
  assert.equal(entradaPedido(undefined, item, pedido), null)
})

test('pedido sem o campo esperado, nao gera entrada (nao quebra)', () => {
  assert.equal(entradaPedido(1579, item, { id: 1279 }), null)
  assert.equal(entradaPedido(1579, item, null), null)
})

test('campo do pedido e configuravel (NOMUS_CAMPO_PEDIDO)', () => {
  const entrada = entradaPedido(1579, item, { numeroPedido: 'PV-2026-0431' }, 'numeroPedido')
  assert.deepEqual(entrada, [1579, { pedido: 'PV-2026-0431', produto: null }])
})
