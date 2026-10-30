import test from 'node:test'
import assert from 'node:assert/strict'
import { apontamentosDaOperacao, mensagemProcessoJaApontado, processoSemTravas } from './duplicidade.js'

test('apontamentosDaOperacao devolve so os da operacao pedida (id numero ou texto)', () => {
  const lista = [
    { id: 1, idOperacaoOrdem: 7524 },
    { id: 2, idOperacaoOrdem: '7524' },
    { id: 3, idOperacaoOrdem: 7525 },
  ]
  assert.deepEqual(apontamentosDaOperacao(lista, 7524).map((a) => a.id), [1, 2])
  assert.deepEqual(apontamentosDaOperacao(lista, '7525').map((a) => a.id), [3])
  assert.deepEqual(apontamentosDaOperacao(lista, 9999), [])
})

test('apontamentosDaOperacao aguenta lista vazia/ausente', () => {
  assert.deepEqual(apontamentosDaOperacao(undefined, 1), [])
  assert.deepEqual(apontamentosDaOperacao([], 1), [])
})

test('mensagem diz qual ordem e qual processo ja foram apontados', () => {
  const msg = mensagemProcessoJaApontado(
    { nomeOrdem: 'OS 02764 - 001', operacao: '10', descricao: 'Corte da telha' },
    [{ dataHoraFinal: '22/10/2026 15:15:57' }, { dataHoraFinal: '19/10/2026 11:10:22' }],
  )
  assert.match(msg, /OS 02764 - 001 já foi apontada para o processo 10 - Corte da telha/)
  assert.match(msg, /22\/10\/2026 15:15:57/)
  assert.match(msg, /só pode ser apontado uma vez/)
})

test('mensagem funciona sem descricao nem data', () => {
  const msg = mensagemProcessoJaApontado({ nomeOrdem: 'OS 1', operacao: '20' })
  assert.match(msg, /processo 20\./)
})

test('processoSemTravas: so o centro CORTE (texto ou objeto, qualquer caixa) fica livre', () => {
  assert.equal(processoSemTravas({ centroTrabalhoPlanejado: 'CORTE' }), true)
  assert.equal(processoSemTravas({ centroTrabalhoPlanejado: 'Corte' }), true)
  assert.equal(processoSemTravas({ centroTrabalhoPlanejado: { id: 1, nome: 'CORTE' } }), true)
  // a operacao 15 (corte de forro) usa o centro CORTE no Nomus: tambem livre
  assert.equal(processoSemTravas({ operacao: '15', centroTrabalhoPlanejado: 'CORTE' }), true)
})

test('processoSemTravas: os demais centros continuam travados (inclusive Corte/Dobra)', () => {
  for (const centro of ['CORTE/DOBRA', 'PINTURA', 'COLAGEM', 'EXPEDIÇÃO', 'LOGÍSTICA']) {
    assert.equal(processoSemTravas({ centroTrabalhoPlanejado: centro }), false, centro)
  }
  assert.equal(processoSemTravas({}), false)
  assert.equal(processoSemTravas(undefined), false)
})
