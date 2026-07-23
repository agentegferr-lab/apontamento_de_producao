import { db } from './db.js'
import { config } from './config.js'
import { hashSenha } from './auth.js'

/**
 * Cria o admin inicial se a tabela usuarios estiver vazia — sem isso ninguem consegue
 * logar na primeira vez que o banco sobe (nao ha tela de "primeiro cadastro"). Roda uma
 * vez por boot, mas so tem efeito quando a tabela esta mesmo vazia.
 */
function bootstrap() {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get()
  if (total > 0) return

  if (!config.adminEmailInicial || !config.adminSenhaInicial) {
    console.warn(
      '[bootstrap] Nenhum usuário cadastrado ainda e ADMIN_EMAIL_INICIAL/ADMIN_SENHA_INICIAL não ' +
        'foram definidos — ninguém consegue logar na intranet. Preencha as duas variáveis no .env e reinicie.',
    )
    return
  }

  const papelAdmin = db.prepare("SELECT id FROM papeis WHERE nome = 'Admin'").get()
  if (!papelAdmin) {
    console.error('[bootstrap] Papel "Admin" não encontrado — verifique a semeadura em server/db.js.')
    return
  }

  db.prepare(
    'INSERT INTO usuarios (nome, email, senha_hash, papel_id, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)',
  ).run(
    'Administrador',
    config.adminEmailInicial.toLowerCase(),
    hashSenha(config.adminSenhaInicial),
    papelAdmin.id,
    new Date().toISOString(),
  )

  console.log(`[bootstrap] Usuário admin inicial criado: ${config.adminEmailInicial} — troque a senha após o primeiro login.`)
}

bootstrap()
