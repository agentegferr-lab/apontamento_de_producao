import { db } from './db.js'
import { AppError } from './erros.js'

/** Mural de avisos — CRUD simples sobre o SQLite. */

const SELECT_AVISO = `
  SELECT a.*, u.nome AS autor_nome FROM avisos a JOIN usuarios u ON u.id = a.autor_id
`

function avisoPublico(linha) {
  return {
    id: linha.id,
    titulo: linha.titulo,
    corpo: linha.corpo,
    autorId: linha.autor_id,
    autorNome: linha.autor_nome,
    fixado: !!linha.fixado,
    criadoEm: linha.criado_em,
  }
}

export const avisos = {
  /** Fixados primeiro, depois mais recentes. */
  listar() {
    return db
      .prepare(`${SELECT_AVISO} ORDER BY a.fixado DESC, a.criado_em DESC`)
      .all()
      .map(avisoPublico)
  },

  criar({ titulo, corpo, autorId, fixado }) {
    if (!titulo?.trim()) throw new AppError('Título é obrigatório.', 400)
    if (!corpo?.trim()) throw new AppError('Texto do aviso é obrigatório.', 400)

    const resultado = db
      .prepare('INSERT INTO avisos (titulo, corpo, autor_id, fixado, criado_em) VALUES (?, ?, ?, ?, ?)')
      .run(titulo.trim(), corpo.trim(), Number(autorId), fixado ? 1 : 0, new Date().toISOString())

    return avisoPublico(db.prepare(`${SELECT_AVISO} WHERE a.id = ?`).get(resultado.lastInsertRowid))
  },

  remover(id) {
    const { changes } = db.prepare('DELETE FROM avisos WHERE id = ?').run(Number(id))
    return changes > 0
  },
}
