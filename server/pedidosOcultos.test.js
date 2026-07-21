import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Arquivo isolado por processo de teste, pra nao mexer no dados/pedidos-ocultos.json real.
process.env.ARQUIVO_PEDIDOS_OCULTOS = path.join(os.tmpdir(), `pedidos-ocultos-teste-${process.pid}.json`)
fs.rmSync(process.env.ARQUIVO_PEDIDOS_OCULTOS, { force: true })

const { pedidosOcultos, normalizarPedido } = await import('./pedidosOcultos.js')

test('normalizarPedido tira o prefixo e os zeros a esquerda', () => {
  assert.equal(normalizarPedido('PD 01038'), '1038')
  assert.equal(normalizarPedido('01038'), '1038')
  assert.equal(normalizarPedido(1038), '1038')
  assert.equal(normalizarPedido('PD 0000'), '0')
  assert.equal(normalizarPedido(''), null)
  assert.equal(normalizarPedido(null), null)
})

test('ocultar guarda o codigo normalizado e e idempotente', () => {
  const registro = pedidosOcultos.ocultar('PD 01038')
  assert.equal(registro.codigo, '1038')
  assert.equal(registro.rotulo, 'PD 01038')

  const denovo = pedidosOcultos.ocultar('1038') // mesma ordem, forma diferente
  assert.equal(denovo.codigo, registro.codigo)
  assert.equal(pedidosOcultos.listar().length, 1, 'nao pode duplicar o mesmo pedido')
})

test('codigos() devolve um Set pronto pro filtro do kanban', () => {
  const set = pedidosOcultos.codigos()
  assert.ok(set instanceof Set)
  assert.ok(set.has('1038'))
})

test('mostrar aceita qualquer forma equivalente e remove da lista', () => {
  pedidosOcultos.ocultar('PD 00496')
  assert.equal(pedidosOcultos.mostrar('496'), true)
  assert.equal(pedidosOcultos.codigos().has('496'), false)
  assert.equal(pedidosOcultos.mostrar('496'), false, 'ja removido, segunda vez devolve false')
})

test('ocultar valor invalido (sem digitos) devolve null e nao entra na lista', () => {
  const antes = pedidosOcultos.listar().length
  assert.equal(pedidosOcultos.ocultar('sem numero'), null)
  assert.equal(pedidosOcultos.listar().length, antes)
})
