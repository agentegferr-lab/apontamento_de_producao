import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { db } from './db.js'
import { AppError } from './erros.js'

/** Repositório de documentos — arquivo em disco (mesmo volume de dados/), metadados no SQLite. */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PASTA_DOCUMENTOS = process.env.ARQUIVO_DOCUMENTOS_DIR
  ? path.resolve(process.env.ARQUIVO_DOCUMENTOS_DIR)
  : path.join(__dirname, '..', 'dados', 'documentos')

fs.mkdirSync(PASTA_DOCUMENTOS, { recursive: true })

const TAMANHO_MAX_BYTES = Number(process.env.DOCUMENTOS_TAMANHO_MAX_MB || 20) * 1024 * 1024

const armazenamento = multer.diskStorage({
  destination: (_req, _arquivo, cb) => cb(null, PASTA_DOCUMENTOS),
  filename: (_req, arquivo, cb) => {
    // Nome no disco e so o id — o nome original (o que o usuario ve) fica no banco. Evita
    // colisao e problema de caracteres especiais/path traversal no filesystem.
    cb(null, `${crypto.randomUUID()}${path.extname(arquivo.originalname).slice(0, 10)}`)
  },
})

export const uploadDocumento = multer({ storage: armazenamento, limits: { fileSize: TAMANHO_MAX_BYTES } }).single(
  'arquivo',
)

const SELECT_DOCUMENTO = `
  SELECT d.*, u.nome AS enviado_por_nome FROM documentos d JOIN usuarios u ON u.id = d.enviado_por
`

function documentoPublico(linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    pasta: linha.pasta,
    tamanho: linha.tamanho,
    tipo: linha.tipo,
    enviadoPor: linha.enviado_por,
    enviadoPorNome: linha.enviado_por_nome,
    criadoEm: linha.criado_em,
  }
}

export const documentos = {
  listar() {
    return db.prepare(`${SELECT_DOCUMENTO} ORDER BY d.pasta, d.nome`).all().map(documentoPublico)
  },

  /** Devolve o registro completo (com caminho em disco) — so pra rota de download, nunca pro cliente. */
  obterComCaminho(id) {
    const linha = db.prepare(`${SELECT_DOCUMENTO} WHERE d.id = ?`).get(Number(id))
    if (!linha) return null
    return { ...documentoPublico(linha), caminhoArquivo: path.join(PASTA_DOCUMENTOS, linha.caminho_arquivo) }
  },

  /** Chamado depois que o multer ja gravou o arquivo em disco (ver uploadDocumento acima). */
  registrar({ nomeOriginal, nomeArquivo, pasta, tamanho, tipo, enviadoPor }) {
    const resultado = db
      .prepare(
        `INSERT INTO documentos (nome, pasta, caminho_arquivo, tamanho, tipo, enviado_por, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nomeOriginal,
        pasta?.trim() || 'Geral',
        nomeArquivo,
        tamanho,
        tipo || null,
        Number(enviadoPor),
        new Date().toISOString(),
      )
    return documentos.obterComCaminho(resultado.lastInsertRowid)
  },

  remover(id) {
    const linha = db.prepare('SELECT * FROM documentos WHERE id = ?').get(Number(id))
    if (!linha) return false
    db.prepare('DELETE FROM documentos WHERE id = ?').run(linha.id)
    fs.rm(path.join(PASTA_DOCUMENTOS, linha.caminho_arquivo), { force: true }, (erro) => {
      if (erro) console.error(`[documentos] falha ao apagar arquivo de ${linha.id}:`, erro.message)
    })
    return true
  },
}

export function erroDeUpload(erro) {
  if (erro instanceof multer.MulterError) {
    if (erro.code === 'LIMIT_FILE_SIZE') {
      return new AppError(`Arquivo maior que o limite (${TAMANHO_MAX_BYTES / 1024 / 1024}MB).`, 413)
    }
    return new AppError(`Falha no upload: ${erro.message}`, 400)
  }
  return null
}
