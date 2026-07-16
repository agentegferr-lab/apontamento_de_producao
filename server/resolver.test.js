import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizarCodigo, resolverNaLista, ResolucaoError } from './resolver.js'

// Dados reais confirmados contra o Nomus (Grupo Ferro) em 2026-07-15: o codigo de barras
// da ordem e o campo idOrdem, o do processo e o campo id — nao os numeros de exibicao.
const operacoes = [
  { id: 2739, idOrdem: 1504, nomeOrdem: 'OS 01498 - 001', operacao: 10, descricao: 'CORTE', centroTrabalhoPlanejado: 'CORTE' },
  { id: 2740, idOrdem: 1504, nomeOrdem: 'OS 01498 - 001', operacao: 20, descricao: 'PINTURA', centroTrabalhoPlanejado: 'PINTURA' },
  { id: 2647, idOrdem: 1450, nomeOrdem: 'OS 01444 - 001', operacao: 10, descricao: 'CORTE', centroTrabalhoPlanejado: 'CORTE' },
]

test('normalizarCodigo tira zeros a esquerda, parenteses e espacos', () => {
  assert.equal(normalizarCodigo('2739'), '2739')
  assert.equal(normalizarCodigo('(2739)'), '2739')
  assert.equal(normalizarCodigo(' 02739 '), '2739')
  assert.equal(normalizarCodigo(2739), '2739')
  assert.equal(normalizarCodigo(''), '')
  assert.equal(normalizarCodigo(null), '')
})

test('resolve pelo id do processo, com o codigo da ordem como conferencia — caso real 1504/2739', () => {
  const op = resolverNaLista(operacoes, '1504', '2739')
  assert.equal(op.idOperacaoOrdem, 2739)
  assert.equal(op.idOrdem, 1504)
  assert.equal(op.nomeOrdem, 'OS 01498 - 001')
})

test('resolve com zero a esquerda na etiqueta — caso real 1450/2647', () => {
  const op = resolverNaLista(operacoes, '01450', '02647')
  assert.equal(op.idOperacaoOrdem, 2647)
  assert.equal(op.idOrdem, 1450)
})

test('processo de uma ordem, ordem de outra: erro de conferencia, nao resolve a ordem errada', () => {
  assert.throws(() => resolverNaLista(operacoes, '1450', '2739'), (erro) => {
    assert.ok(erro instanceof ResolucaoError)
    assert.equal(erro.codigo, 'ORDEM_PROCESSO_NAO_CORRESPONDEM')
    return true
  })
})

test('processo inexistente: erro claro, nao ambiguidade', () => {
  assert.throws(() => resolverNaLista(operacoes, '1504', '99999'), (erro) => {
    assert.equal(erro.codigo, 'PROCESSO_NAO_ENCONTRADO')
    return true
  })
})

test('codigo vazio nunca resolve', () => {
  assert.throws(() => resolverNaLista(operacoes, '', '2739'), (erro) => erro.codigo === 'ORDEM_VAZIA')
  assert.throws(() => resolverNaLista(operacoes, '1504', ''), (erro) => erro.codigo === 'PROCESSO_VAZIO')
})

test('leva recursosPlanejados adiante quando presente, pro recursos.js usar', () => {
  const comRecurso = [{ ...operacoes[0], recursosPlanejados: [{ id: 5, nomeRecurso: 'TR25-Corte' }] }]
  const op = resolverNaLista(comRecurso, '1504', '2739')
  assert.deepEqual(op.recursosPlanejados, [{ id: 5, nomeRecurso: 'TR25-Corte' }])
})
