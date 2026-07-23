import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.ARQUIVO_DB = path.join(os.tmpdir(), `intranet-teste-auth-${process.pid}.db`)
fs.rmSync(process.env.ARQUIVO_DB, { force: true })

const { hashSenha, verificarSenha, autenticar, usuarioDaSessao, destruirSessao } = await import('./auth.js')
const { db } = await import('./db.js')

let contador = 0
function criarUsuarioTeste({ senha = 'senha123', papelNome = 'Admin' } = {}) {
  contador += 1
  const email = `teste${contador}@teste.com`
  const papel = db.prepare('SELECT id FROM papeis WHERE nome = ?').get(papelNome)
  db.prepare(
    'INSERT INTO usuarios (nome, email, senha_hash, papel_id, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)',
  ).run('Fulano', email, hashSenha(senha), papel.id, new Date().toISOString())
  return email
}

test('hashSenha/verificarSenha: senha certa passa, errada nao', () => {
  const hash = hashSenha('abc123')
  assert.equal(verificarSenha('abc123', hash), true)
  assert.equal(verificarSenha('errada', hash), false)
})

test('autenticar com credenciais certas devolve usuario com papel/modulos e um token valido', () => {
  const email = criarUsuarioTeste({ senha: 'segredo123' })
  const resultado = autenticar(email, 'segredo123')
  assert.ok(resultado)
  assert.equal(resultado.usuario.email, email)
  assert.equal(resultado.usuario.papel.nome, 'Admin')
  assert.ok(resultado.usuario.modulos.includes('admin.usuarios'))

  const daSessao = usuarioDaSessao(resultado.token)
  assert.equal(daSessao.email, email)
})

test('autenticar com senha errada ou email inexistente devolve null', () => {
  const email = criarUsuarioTeste({ senha: 'certasenha' })
  assert.equal(autenticar(email, 'errada'), null)
  assert.equal(autenticar('naoexiste@x.com', 'qualquer'), null)
})

test('destruirSessao invalida o token na hora', () => {
  const email = criarUsuarioTeste({ senha: 'certasenha' })
  const { token } = autenticar(email, 'certasenha')
  assert.ok(usuarioDaSessao(token))
  destruirSessao(token)
  assert.equal(usuarioDaSessao(token), null)
})

test('usuarioDaSessao com token invalido ou ausente devolve null, nao quebra', () => {
  assert.equal(usuarioDaSessao('token-que-nao-existe'), null)
  assert.equal(usuarioDaSessao(undefined), null)
})
