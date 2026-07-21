import test from 'node:test'
import assert from 'node:assert/strict'
import { filtrarSugestoes } from './ia.js'

const backlog = [
  { idOperacaoOrdem: 2906, nomeOrdem: 'OS 01580 - 001', pedido: 'PD 01291', valorTotal: '1.500,00' },
  { idOperacaoOrdem: 2907, nomeOrdem: 'OS 01581 - 001', pedido: 'PD 01292', valorTotal: '2.000,00' },
]

test('mantem sugestoes com idOperacaoOrdem real e data dentro do periodo', () => {
  const resultado = filtrarSugestoes(
    [
      { idOperacaoOrdem: 2906, data: '2026-08-05', motivo: 'maior valor' },
      { idOperacaoOrdem: 2907, data: '2026-08-06', motivo: 'completa o alvo' },
    ],
    { backlog, dataInicio: '2026-08-01', dataFim: '2026-08-07' },
  )
  assert.equal(resultado.length, 2)
  assert.equal(resultado[0].nomeOrdem, 'OS 01580 - 001') // enriquecido com os dados do backlog
  assert.equal(resultado[0].data, '2026-08-05')
  assert.equal(resultado[0].motivo, 'maior valor')
})

test('descarta idOperacaoOrdem que nao esta no backlog (alucinacao da IA)', () => {
  const resultado = filtrarSugestoes([{ idOperacaoOrdem: 999999, data: '2026-08-05' }], {
    backlog,
    dataInicio: '2026-08-01',
    dataFim: '2026-08-07',
  })
  assert.deepEqual(resultado, [])
})

test('descarta data fora do periodo pedido, mesmo com formato valido', () => {
  const resultado = filtrarSugestoes(
    [
      { idOperacaoOrdem: 2906, data: '2026-07-15' }, // antes do periodo
      { idOperacaoOrdem: 2907, data: '2026-09-01' }, // depois do periodo
    ],
    { backlog, dataInicio: '2026-08-01', dataFim: '2026-08-07' },
  )
  assert.deepEqual(resultado, [])
})

test('descarta data com formato invalido', () => {
  const resultado = filtrarSugestoes([{ idOperacaoOrdem: 2906, data: '05/08/2026' }], {
    backlog,
    dataInicio: '2026-08-01',
    dataFim: '2026-08-07',
  })
  assert.deepEqual(resultado, [])
})

test('sem motivo, fica null; lista vazia ou ausente nao quebra', () => {
  const comMotivoNull = filtrarSugestoes([{ idOperacaoOrdem: 2906, data: '2026-08-05' }], {
    backlog,
    dataInicio: '2026-08-01',
    dataFim: '2026-08-07',
  })
  assert.equal(comMotivoNull[0].motivo, null)

  assert.deepEqual(filtrarSugestoes([], { backlog, dataInicio: '2026-08-01', dataFim: '2026-08-07' }), [])
  assert.deepEqual(filtrarSugestoes(undefined, { backlog, dataInicio: '2026-08-01', dataFim: '2026-08-07' }), [])
})
