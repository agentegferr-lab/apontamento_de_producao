import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.ARQUIVO_MOTORISTAS = path.join(os.tmpdir(), `motoristas-teste-${process.pid}.json`)
fs.rmSync(process.env.ARQUIVO_MOTORISTAS, { force: true })

const { motoristas } = await import('./motoristas.js')

test('criar exige nome, comeca ativo', () => {
  assert.throws(() => motoristas.criar({ nome: '' }), /nome/)
  const registro = motoristas.criar({ nome: 'Joao da Silva' })
  assert.equal(registro.nome, 'Joao da Silva')
  assert.equal(registro.ativo, true)
  assert.ok(registro.id)
})

test('atualizar troca so os campos informados e pode desativar', () => {
  const registro = motoristas.criar({ nome: 'Maria Souza' })
  const atualizado = motoristas.atualizar(registro.id, { ativo: false })
  assert.equal(atualizado.nome, 'Maria Souza')
  assert.equal(atualizado.ativo, false)
})

test('atualizar com id inexistente lanca 404', () => {
  assert.throws(() => motoristas.atualizar('nao-existe', { ativo: false }), (erro) => erro.status === 404)
})
