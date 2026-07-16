import test from 'node:test'
import assert from 'node:assert/strict'
import { escolherRecursoPlanejado } from './recursos.js'

// Formato confirmado contra o Nomus real em 2026-07-15 (node ferramentas/diagnostico.js).
test('usa o recurso planejado da propria operacao quando existe', () => {
  const r = escolherRecursoPlanejado([{ id: 3552, nomeRecurso: 'CAMINHÃO', tempoMODLote: 2 }])
  assert.deepEqual(r, { id: 3552, nome: 'CAMINHÃO', ambiguo: false })
})

test('sem nomeRecurso, usa um nome generico em vez de undefined', () => {
  const r = escolherRecursoPlanejado([{ id: 42 }])
  assert.equal(r.nome, 'recurso 42')
})

test('mais de um planejado: usa o primeiro e marca como ambiguo', () => {
  const r = escolherRecursoPlanejado([{ id: 1, nomeRecurso: 'A' }, { id: 2, nomeRecurso: 'B' }])
  assert.equal(r.id, 1)
  assert.equal(r.ambiguo, true)
})

test('lista vazia, ausente ou so com itens sem id: cai pra reserva (retorna null)', () => {
  assert.equal(escolherRecursoPlanejado([]), null)
  assert.equal(escolherRecursoPlanejado(undefined), null)
  assert.equal(escolherRecursoPlanejado([{ nomeRecurso: 'sem id' }]), null)
})
