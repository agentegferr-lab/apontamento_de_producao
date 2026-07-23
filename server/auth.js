import crypto from 'node:crypto'
import { db } from './db.js'
import { config } from './config.js'

/**
 * Login da intranet — cookie httpOnly assinado (cookie-parser) carregando um token opaco,
 * validado contra a tabela `sessoes` do SQLite. Nada de express-session/passport: o app
 * inteiro ja resolve persistencia com helpers proprios (ver andamento.js/planejamento.js),
 * entao sessao segue o mesmo espirito em vez de trazer uma dependencia grande pra isso.
 */

const TAMANHO_SALT = 16
const TAMANHO_HASH = 64

export function hashSenha(senhaPlana) {
  const salt = crypto.randomBytes(TAMANHO_SALT)
  const hash = crypto.scryptSync(senhaPlana, salt, TAMANHO_HASH)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verificarSenha(senhaPlana, senhaHash) {
  const [saltHex, hashHex] = (senhaHash ?? '').split(':')
  if (!saltHex || !hashHex) return false
  const hashEsperado = Buffer.from(hashHex, 'hex')
  const hashRecebido = crypto.scryptSync(senhaPlana, Buffer.from(saltHex, 'hex'), TAMANHO_HASH)
  // Tamanhos sempre batem (TAMANHO_HASH fixo), mas timingSafeEqual exige o mesmo length —
  // confere antes pra nao lancar em vez de so devolver "senha errada".
  if (hashEsperado.length !== hashRecebido.length) return false
  return crypto.timingSafeEqual(hashEsperado, hashRecebido)
}

/** Monta o objeto de usuario exposto pro resto do app (rota /api/auth/eu, req.usuario). */
function usuarioParaSessao(linha) {
  const modulos = db
    .prepare('SELECT modulo_chave FROM papel_modulos WHERE papel_id = ?')
    .all(linha.papel_id)
    .map((m) => m.modulo_chave)

  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    papel: { id: linha.papel_id, nome: linha.papel_nome },
    modulos,
    matriculaNomus: linha.matricula_nomus,
    setor: linha.setor,
    cargo: linha.cargo,
    ramal: linha.ramal,
  }
}

const BUSCAR_USUARIO_POR_EMAIL = `
  SELECT u.*, p.nome AS papel_nome FROM usuarios u JOIN papeis p ON p.id = u.papel_id
  WHERE u.email = ? AND u.ativo = 1
`
const BUSCAR_USUARIO_POR_ID = `
  SELECT u.*, p.nome AS papel_nome FROM usuarios u JOIN papeis p ON p.id = u.papel_id
  WHERE u.id = ? AND u.ativo = 1
`

/** POST /api/auth/login — devolve {usuario, token} ou null se credenciais invalidas. */
export function autenticar(email, senhaPlana) {
  const linha = db.prepare(BUSCAR_USUARIO_POR_EMAIL).get(String(email ?? '').trim().toLowerCase())
  if (!linha) return null
  if (!verificarSenha(senhaPlana ?? '', linha.senha_hash)) return null

  const token = crypto.randomUUID()
  const agora = new Date()
  const expiraEm = new Date(agora.getTime() + config.sessaoDuracaoHoras * 3_600_000)
  db.prepare('INSERT INTO sessoes (token, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)').run(
    token,
    linha.id,
    agora.toISOString(),
    expiraEm.toISOString(),
  )

  return { usuario: usuarioParaSessao(linha), token }
}

export function destruirSessao(token) {
  if (!token) return
  db.prepare('DELETE FROM sessoes WHERE token = ?').run(token)
}

/** Resolve um token de cookie pro usuario logado, ou null (sessao ausente/expirada/usuario desativado). */
export function usuarioDaSessao(token) {
  if (!token) return null
  const sessao = db.prepare('SELECT * FROM sessoes WHERE token = ?').get(token)
  if (!sessao) return null

  if (new Date(sessao.expira_em) <= new Date()) {
    db.prepare('DELETE FROM sessoes WHERE token = ?').run(token)
    return null
  }

  const linha = db.prepare(BUSCAR_USUARIO_POR_ID).get(sessao.usuario_id)
  if (!linha) return null
  return usuarioParaSessao(linha)
}

const NOME_COOKIE = 'sessao'
const OPCOES_COOKIE = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  signed: true,
  maxAge: config.sessaoDuracaoHoras * 3_600_000,
})

export function definirCookieSessao(res, token) {
  res.cookie(NOME_COOKIE, token, OPCOES_COOKIE())
}

export function limparCookieSessao(res) {
  res.clearCookie(NOME_COOKIE, OPCOES_COOKIE())
}

/** Middleware: exige login, preenche req.usuario. 401 sem sessao valida. */
export function exigirLogin(req, res, next) {
  const usuario = usuarioDaSessao(req.signedCookies?.[NOME_COOKIE])
  if (!usuario) return res.status(401).json({ mensagem: 'Faça login para continuar.', codigo: 'NAO_AUTENTICADO' })
  req.usuario = usuario
  next()
}

/** Middleware: exige login E que o papel do usuario tenha o modulo liberado. 403 caso contrario. */
export function exigirModulo(chave) {
  return (req, res, next) =>
    exigirLogin(req, res, () => {
      if (!req.usuario.modulos.includes(chave)) {
        return res.status(403).json({ mensagem: 'Seu usuário não tem acesso a este módulo.', codigo: 'SEM_ACESSO' })
      }
      next()
    })
}
