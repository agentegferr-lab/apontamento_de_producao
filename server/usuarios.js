import { db, MODULOS } from './db.js'
import { hashSenha } from './auth.js'
import { AppError } from './erros.js'

/** CRUD de usuarios e papeis da intranet — sobre o SQLite de server/db.js. */

function papelComModulos(linha) {
  const modulos = db
    .prepare('SELECT modulo_chave FROM papel_modulos WHERE papel_id = ?')
    .all(linha.id)
    .map((m) => m.modulo_chave)
  return { id: linha.id, nome: linha.nome, modulos }
}

function usuarioPublico(linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    papelId: linha.papel_id,
    papelNome: linha.papel_nome,
    matriculaNomus: linha.matricula_nomus,
    setor: linha.setor,
    cargo: linha.cargo,
    ramal: linha.ramal,
    ativo: !!linha.ativo,
    criadoEm: linha.criado_em,
  }
}

export const papeis = {
  listar() {
    return db.prepare('SELECT * FROM papeis ORDER BY nome').all().map(papelComModulos)
  },

  /** Substitui a lista de modulos liberados pro papel (ignora chaves desconhecidas). */
  atualizarModulos(id, modulosPedidos) {
    const papel = db.prepare('SELECT * FROM papeis WHERE id = ?').get(Number(id))
    if (!papel) throw new AppError('Papel não encontrado.', 404)

    const validos = new Set(Object.values(MODULOS))
    const filtrados = [...new Set((modulosPedidos ?? []).filter((m) => validos.has(m)))]

    db.prepare('DELETE FROM papel_modulos WHERE papel_id = ?').run(papel.id)
    const inserir = db.prepare('INSERT INTO papel_modulos (papel_id, modulo_chave) VALUES (?, ?)')
    for (const modulo of filtrados) inserir.run(papel.id, modulo)

    return papelComModulos(papel)
  },
}

const SELECT_USUARIO = 'SELECT u.*, p.nome AS papel_nome FROM usuarios u JOIN papeis p ON p.id = u.papel_id'

function normalizarTexto(valor) {
  const t = valor?.trim()
  return t ? t : null
}

export const usuarios = {
  /** incluirInativos: true so pra tela de admin (diretorio/login so consideram quem esta ativo). */
  listar({ incluirInativos = false } = {}) {
    const sql = `${SELECT_USUARIO}${incluirInativos ? '' : ' WHERE u.ativo = 1'} ORDER BY u.nome`
    return db.prepare(sql).all().map(usuarioPublico)
  },

  obter(id) {
    const linha = db.prepare(`${SELECT_USUARIO} WHERE u.id = ?`).get(Number(id))
    return linha ? usuarioPublico(linha) : null
  },

  criar({ nome, email, senha, papelId, matriculaNomus, setor, cargo, ramal }) {
    if (!normalizarTexto(nome)) throw new AppError('Nome é obrigatório.', 400)
    const emailNormalizado = String(email ?? '').trim().toLowerCase()
    if (!emailNormalizado) throw new AppError('E-mail é obrigatório.', 400)
    if (!senha || senha.length < 6) throw new AppError('Senha precisa ter ao menos 6 caracteres.', 400)
    if (!db.prepare('SELECT id FROM papeis WHERE id = ?').get(Number(papelId))) {
      throw new AppError('Papel inválido.', 400)
    }

    let resultado
    try {
      resultado = db
        .prepare(
          `INSERT INTO usuarios (nome, email, senha_hash, papel_id, matricula_nomus, setor, cargo, ramal, ativo, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          nome.trim(),
          emailNormalizado,
          hashSenha(senha),
          Number(papelId),
          normalizarTexto(matriculaNomus),
          normalizarTexto(setor),
          normalizarTexto(cargo),
          normalizarTexto(ramal),
          new Date().toISOString(),
        )
    } catch (erro) {
      if (String(erro.message).includes('UNIQUE')) throw new AppError('Já existe um usuário com este e-mail.', 409)
      throw erro
    }
    return usuarios.obter(resultado.lastInsertRowid)
  },

  atualizar(id, campos) {
    const atual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(id))
    if (!atual) throw new AppError('Usuário não encontrado.', 404)

    const { nome, email, senha, papelId, matriculaNomus, setor, cargo, ramal, ativo } = campos ?? {}
    if (papelId != null && !db.prepare('SELECT id FROM papeis WHERE id = ?').get(Number(papelId))) {
      throw new AppError('Papel inválido.', 400)
    }
    if (senha != null && senha.length < 6) throw new AppError('Senha precisa ter ao menos 6 caracteres.', 400)

    try {
      db.prepare(
        `UPDATE usuarios SET
           nome = ?, email = ?, senha_hash = ?, papel_id = ?, matricula_nomus = ?, setor = ?, cargo = ?, ramal = ?, ativo = ?
         WHERE id = ?`,
      ).run(
        normalizarTexto(nome) ?? atual.nome,
        email !== undefined ? String(email).trim().toLowerCase() : atual.email,
        senha ? hashSenha(senha) : atual.senha_hash,
        papelId != null ? Number(papelId) : atual.papel_id,
        matriculaNomus !== undefined ? normalizarTexto(matriculaNomus) : atual.matricula_nomus,
        setor !== undefined ? normalizarTexto(setor) : atual.setor,
        cargo !== undefined ? normalizarTexto(cargo) : atual.cargo,
        ramal !== undefined ? normalizarTexto(ramal) : atual.ramal,
        ativo != null ? (ativo ? 1 : 0) : atual.ativo,
        atual.id,
      )
    } catch (erro) {
      if (String(erro.message).includes('UNIQUE')) throw new AppError('Já existe um usuário com este e-mail.', 409)
      throw erro
    }

    // Desativar um usuario derruba as sessoes dele na hora, nao so no proximo login.
    if (ativo === false) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(atual.id)

    return usuarios.obter(atual.id)
  },
}
