import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Arquivo isolado por processo de teste, pra nao mexer no dados/planejamento.json real.
process.env.ARQUIVO_PLANEJAMENTO = path.join(os.tmpdir(), `planejamento-teste-${process.pid}.json`)
fs.rmSync(process.env.ARQUIVO_PLANEJAMENTO, { force: true })

const { planejamento } = await import('./planejamento.js')

test('agendar cria um item novo e persiste', () => {
  const registro = planejamento.agendar({
    idOrdem: 1450,
    idOperacaoOrdem: 2647,
    nomeOrdem: 'OS 01444 - 001',
    pedido: 'PD 01192',
    produto: 'TELHA X',
    data: '2026-08-03',
  })
  assert.equal(registro.idOrdem, 1450)
  assert.equal(registro.idOperacaoOrdem, 2647)
  assert.equal(registro.data, '2026-08-03')
  assert.ok(registro.id)
  assert.deepEqual(planejamento.listar().map((i) => i.id), [registro.id])
})

test('agendar guarda quantidade/unidade/codigoProduto/idProduto/idPedido/valorTotal quando informados, null quando nao', () => {
  const comQtde = planejamento.agendar({
    idOrdem: 10,
    idOperacaoOrdem: 5000,
    nomeOrdem: 'OS COM QTDE',
    idPedido: 1290,
    idProduto: 8,
    codigoProduto: '0006',
    quantidade: '1.287,64',
    unidadeMedida: 'M2',
    valorTotal: '1.805,61',
    data: '2026-08-20',
  })
  assert.equal(comQtde.idPedido, 1290)
  assert.equal(comQtde.idProduto, 8)
  assert.equal(comQtde.codigoProduto, '0006')
  assert.equal(comQtde.quantidade, '1.287,64')
  assert.equal(comQtde.unidadeMedida, 'M2')
  assert.equal(comQtde.valorTotal, '1.805,61')

  const semQtde = planejamento.agendar({
    idOrdem: 11,
    idOperacaoOrdem: 5001,
    nomeOrdem: 'OS SEM QTDE',
    data: '2026-08-20',
  })
  assert.equal(semQtde.idPedido, null)
  assert.equal(semQtde.idProduto, null)
  assert.equal(semQtde.codigoProduto, null)
  assert.equal(semQtde.quantidade, null)
  assert.equal(semQtde.unidadeMedida, null)
  assert.equal(semQtde.valorTotal, null)
})

test('agendar a mesma operacao de novo e idempotente (nao duplica)', () => {
  const antes = planejamento.listar().length
  const primeiro = planejamento.agendar({
    idOrdem: 1,
    idOperacaoOrdem: 999,
    nomeOrdem: 'OS TESTE',
    data: '2026-08-05',
  })
  const segundo = planejamento.agendar({
    idOrdem: 1,
    idOperacaoOrdem: 999,
    nomeOrdem: 'OS TESTE',
    data: '2026-08-06', // data diferente, mas mesma operacao — devolve o original, nao move
  })
  assert.equal(primeiro.id, segundo.id)
  assert.equal(segundo.data, '2026-08-05')
  assert.equal(planejamento.listar().length, antes + 1)
})

test('mover troca a data de um item existente', () => {
  const registro = planejamento.agendar({ idOrdem: 2, idOperacaoOrdem: 111, nomeOrdem: 'OS MOVER', data: '2026-08-10' })
  const movido = planejamento.mover(registro.id, '2026-08-12')
  assert.equal(movido.data, '2026-08-12')
  assert.equal(planejamento.listar().find((i) => i.id === registro.id).data, '2026-08-12')
})

test('mover um id inexistente devolve null, nao quebra', () => {
  assert.equal(planejamento.mover('id-que-nao-existe', '2026-08-01'), null)
})

test('remover tira o item da lista e devolve true; id inexistente devolve false', () => {
  const registro = planejamento.agendar({ idOrdem: 3, idOperacaoOrdem: 222, nomeOrdem: 'OS REMOVER', data: '2026-08-15' })
  assert.equal(planejamento.remover(registro.id), true)
  assert.equal(planejamento.listar().some((i) => i.id === registro.id), false)
  assert.equal(planejamento.remover(registro.id), false)
})
