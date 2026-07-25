import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.ARQUIVO_CAMINHOES = path.join(os.tmpdir(), `caminhoes-teste-${process.pid}.json`)
fs.rmSync(process.env.ARQUIVO_CAMINHOES, { force: true })

const { caminhoes } = await import('./caminhoes.js')

test('criar exige placa, comeca ativo', () => {
  assert.throws(() => caminhoes.criar({ placa: '' }), /placa/)
  const registro = caminhoes.criar({ placa: 'ABC1234', modelo: 'VUC' })
  assert.equal(registro.placa, 'ABC1234')
  assert.equal(registro.modelo, 'VUC')
  assert.equal(registro.ativo, true)
  assert.ok(registro.id)
})

test('listar devolve uma copia, nao a referencia interna', () => {
  const lista = caminhoes.listar()
  lista.push({ id: 'intruso' })
  assert.equal(caminhoes.listar().some((c) => c.id === 'intruso'), false)
})

test('atualizar troca so os campos informados e pode desativar', () => {
  const registro = caminhoes.criar({ placa: 'XYZ9876' })
  const atualizado = caminhoes.atualizar(registro.id, { ativo: false })
  assert.equal(atualizado.placa, 'XYZ9876', 'placa nao informada, preserva')
  assert.equal(atualizado.ativo, false)
})

test('atualizar com id inexistente lanca 404', () => {
  assert.throws(() => caminhoes.atualizar('nao-existe', { ativo: false }), (erro) => erro.status === 404)
})

test('atualizar com placa vazia lanca erro, nao apaga o cadastro', () => {
  const registro = caminhoes.criar({ placa: 'DEF4567' })
  assert.throws(() => caminhoes.atualizar(registro.id, { placa: '  ' }), /placa/)
})
