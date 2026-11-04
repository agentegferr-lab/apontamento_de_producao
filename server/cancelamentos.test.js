import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// Antes de importar: o arquivo e lido no import.
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'canc-test-'))
const arquivo = path.join(pasta, 'cancelamentos.json')
process.env.ARQUIVO_CANCELAMENTOS = arquivo
process.env.ARQUIVO_CANCELAMENTOS_FIXOS = path.join(pasta, 'fixos.json')
fs.writeFileSync(process.env.ARQUIVO_CANCELAMENTOS_FIXOS, JSON.stringify({ ids: [500, '501'] }))
const { cancelamentos } = await import('./cancelamentos.js')

test('comeca so com os ids fixos (correcao manual versionada)', () => {
  assert.deepEqual([...cancelamentos.idsApontamentosCancelados()].sort(), [500, 501])
  assert.deepEqual(cancelamentos.listar(), [])
})

test('GRAVADO guarda os ids movidos pra lixeira; EM_ANDAMENTO nao entra na lista de ignorados', () => {
  cancelamentos.registrar({ tipo: 'GRAVADO', ordem: 'OS 1', cancelados: [10, '11'], falhas: [], motivo: 'Quantidade errada' })
  cancelamentos.registrar({ tipo: 'EM_ANDAMENTO', ordem: 'OS 2', motivo: 'Operação errada' })
  assert.deepEqual([...cancelamentos.idsApontamentosCancelados()].sort(), [10, 11, 500, 501])
  const lista = cancelamentos.listar()
  assert.equal(lista.length, 2)
  assert.equal(lista[0].tipo, 'EM_ANDAMENTO') // mais recente primeiro
  assert.ok(lista[0].em && lista[0].id)
})

test('falha ao cancelar (id fora de "cancelados") nao vira ignorado', () => {
  cancelamentos.registrar({ tipo: 'GRAVADO', ordem: 'OS 3', cancelados: [], falhas: [{ id: 99, motivo: 'Nomus fora' }] })
  assert.equal(cancelamentos.idsApontamentosCancelados().has(99), false)
})

test('tudo fica em disco e volta na proxima subida', async () => {
  const gravado = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  assert.equal(gravado.length, 3)
  const recarregado = (await import('./cancelamentos.js?releitura')).cancelamentos
  assert.deepEqual([...recarregado.idsApontamentosCancelados()].sort(), [10, 11, 500, 501])
})

test.after(() => fs.rmSync(pasta, { recursive: true, force: true }))
