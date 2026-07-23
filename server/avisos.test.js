import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.ARQUIVO_DB = path.join(os.tmpdir(), `intranet-teste-avisos-${process.pid}.db`)
fs.rmSync(process.env.ARQUIVO_DB, { force: true })

const { avisos } = await import('./avisos.js')
const { usuarios, papeis } = await import('./usuarios.js')

let contador = 0
function autorTeste() {
  contador += 1
  const admin = papeis.listar().find((p) => p.nome === 'Admin')
  return usuarios.criar({
    nome: 'Autor',
    email: `autor${contador}@teste.com`,
    senha: 'senha123',
    papelId: admin.id,
  }).id
}

test('criar exige titulo e corpo', () => {
  const autorId = autorTeste()
  assert.throws(() => avisos.criar({ titulo: '', corpo: 'x', autorId }))
  assert.throws(() => avisos.criar({ titulo: 'x', corpo: '', autorId }))
})

test('listar traz fixados primeiro, com o nome do autor', () => {
  const autorId = autorTeste()
  avisos.criar({ titulo: 'Antigo', corpo: 'x', autorId })
  const fixado = avisos.criar({ titulo: 'Fixado', corpo: 'x', autorId, fixado: true })
  const lista = avisos.listar()
  assert.equal(lista[0].id, fixado.id)
  assert.equal(lista[0].autorNome, 'Autor')
})

test('remover tira o aviso da lista; id inexistente devolve false', () => {
  const autorId = autorTeste()
  const aviso = avisos.criar({ titulo: 'X', corpo: 'y', autorId })
  assert.equal(avisos.remover(aviso.id), true)
  assert.equal(avisos.listar().some((a) => a.id === aviso.id), false)
  assert.equal(avisos.remover(aviso.id), false)
})
