import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.ARQUIVO_DB = path.join(os.tmpdir(), `intranet-teste-usuarios-${process.pid}.db`)
fs.rmSync(process.env.ARQUIVO_DB, { force: true })

const { usuarios, papeis } = await import('./usuarios.js')

let contador = 0
function emailUnico() {
  contador += 1
  return `usuario${contador}@teste.com`
}
function idPapel(nome) {
  return papeis.listar().find((p) => p.nome === nome).id
}

test('papeis.listar devolve os papeis padrao semeados, cada um com seus modulos', () => {
  const nomes = papeis.listar().map((p) => p.nome)
  assert.ok(nomes.includes('Admin'))
  assert.ok(nomes.includes('Operador'))
  const admin = papeis.listar().find((p) => p.nome === 'Admin')
  assert.ok(admin.modulos.includes('admin.usuarios'))
})

test('criar cria um usuario, normaliza o e-mail e nunca devolve o hash da senha', () => {
  const usuario = usuarios.criar({
    nome: 'Fulano',
    email: 'Fulano@Teste.com',
    senha: 'senha123',
    papelId: idPapel('Operador'),
    matriculaNomus: '1234',
  })
  assert.equal(usuario.email, 'fulano@teste.com')
  assert.equal(usuario.matriculaNomus, '1234')
  assert.equal('senhaHash' in usuario, false)
  assert.equal('senha_hash' in usuario, false)
})

test('criar com email duplicado falha com status 409', () => {
  const email = emailUnico()
  usuarios.criar({ nome: 'A', email, senha: 'senha123', papelId: idPapel('Operador') })
  assert.throws(
    () => usuarios.criar({ nome: 'B', email, senha: 'outrasenha', papelId: idPapel('Operador') }),
    (erro) => erro.status === 409,
  )
})

test('criar com papel invalido ou senha curta falha', () => {
  assert.throws(() => usuarios.criar({ nome: 'C', email: emailUnico(), senha: 'senha123', papelId: 9999 }))
  assert.throws(() => usuarios.criar({ nome: 'D', email: emailUnico(), senha: '123', papelId: idPapel('Operador') }))
})

test('atualizar troca so os campos informados, preserva o resto', () => {
  const criado = usuarios.criar({
    nome: 'E',
    email: emailUnico(),
    senha: 'senha123',
    papelId: idPapel('Operador'),
    setor: 'Corte',
  })
  const atualizado = usuarios.atualizar(criado.id, { cargo: 'Operador de corte' })
  assert.equal(atualizado.setor, 'Corte')
  assert.equal(atualizado.cargo, 'Operador de corte')
})

test('atualizar com ativo=false desativa, some da listagem padrao e derruba sessoes', () => {
  const criado = usuarios.criar({ nome: 'F', email: emailUnico(), senha: 'senha123', papelId: idPapel('Operador') })
  usuarios.atualizar(criado.id, { ativo: false })
  assert.equal(usuarios.listar().some((u) => u.id === criado.id), false)
  assert.equal(usuarios.listar({ incluirInativos: true }).some((u) => u.id === criado.id), true)
})

test('atualizar com usuario inexistente falha com status 404', () => {
  assert.throws(() => usuarios.atualizar(999999, { nome: 'X' }), (erro) => erro.status === 404)
})

test('papeis.atualizarModulos substitui a lista inteira e ignora chaves desconhecidas', () => {
  const papel = papeis.listar().find((p) => p.nome === 'RH')
  const atualizado = papeis.atualizarModulos(papel.id, ['avisos', 'modulo-que-nao-existe'])
  assert.deepEqual(atualizado.modulos, ['avisos'])
})
