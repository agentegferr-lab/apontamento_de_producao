import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const pastaTeste = path.join(os.tmpdir(), `documentos-teste-${process.pid}`)
process.env.ARQUIVO_DOCUMENTOS_DIR = pastaTeste
process.env.ARQUIVO_DB = path.join(os.tmpdir(), `intranet-teste-documentos-${process.pid}.db`)
fs.rmSync(pastaTeste, { recursive: true, force: true })
fs.rmSync(process.env.ARQUIVO_DB, { force: true })

const { documentos, PASTA_DOCUMENTOS } = await import('./documentos.js')
const { usuarios, papeis } = await import('./usuarios.js')

let contador = 0
function usuarioTeste() {
  contador += 1
  const admin = papeis.listar().find((p) => p.nome === 'Admin')
  return usuarios.criar({
    nome: 'Quem Envia',
    email: `envia${contador}@teste.com`,
    senha: 'senha123',
    papelId: admin.id,
  }).id
}

function criarArquivoFalso(nomeArquivo, conteudo = 'conteudo de teste') {
  fs.writeFileSync(path.join(PASTA_DOCUMENTOS, nomeArquivo), conteudo)
}

test('registrar grava os metadados e obterComCaminho aponta pro arquivo certo em disco', () => {
  const enviadoPor = usuarioTeste()
  criarArquivoFalso('uuid-1.pdf')
  const registro = documentos.registrar({
    nomeOriginal: 'manual.pdf',
    nomeArquivo: 'uuid-1.pdf',
    pasta: 'Manuais',
    tamanho: 123,
    tipo: 'application/pdf',
    enviadoPor,
  })
  assert.equal(registro.nome, 'manual.pdf')
  assert.equal(registro.pasta, 'Manuais')
  assert.equal(registro.enviadoPorNome, 'Quem Envia')
  assert.equal(fs.existsSync(registro.caminhoArquivo), true)
})

test('pasta vazia/nao informada cai pra "Geral"', () => {
  const enviadoPor = usuarioTeste()
  criarArquivoFalso('uuid-2.pdf')
  const registro = documentos.registrar({ nomeOriginal: 'x.pdf', nomeArquivo: 'uuid-2.pdf', tamanho: 1, enviadoPor })
  assert.equal(registro.pasta, 'Geral')
})

test('remover apaga o registro (id inexistente devolve false)', () => {
  const enviadoPor = usuarioTeste()
  criarArquivoFalso('uuid-3.pdf')
  const registro = documentos.registrar({ nomeOriginal: 'y.pdf', nomeArquivo: 'uuid-3.pdf', tamanho: 1, enviadoPor })
  assert.equal(documentos.remover(registro.id), true)
  assert.equal(documentos.listar().some((d) => d.id === registro.id), false)
  assert.equal(documentos.remover(registro.id), false)
})
