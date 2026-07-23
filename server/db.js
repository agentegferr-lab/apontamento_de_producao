import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Banco da intranet (usuarios/papeis/sessoes/avisos/documentos) — separado dos JSONs de
 * andamento.js/planejamento.js, que continuam como estao. Usa o node:sqlite embutido no
 * proprio Node (>=22.5) em vez de better-sqlite3: mesma API sincrona no espirito do resto
 * do projeto (fs.readFileSync/writeFileSync direto), mas sem addon nativo pra compilar —
 * o que travava o build tanto no Windows local (sem Visual Studio) quanto exigiria
 * toolchain extra na imagem Alpine do Docker.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_DB
  ? path.resolve(process.env.ARQUIVO_DB)
  : path.join(__dirname, '..', 'dados', 'intranet.db')

fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })

export const db = new DatabaseSync(ARQUIVO)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS papeis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS papel_modulos (
    papel_id INTEGER NOT NULL REFERENCES papeis(id) ON DELETE CASCADE,
    modulo_chave TEXT NOT NULL,
    PRIMARY KEY (papel_id, modulo_chave)
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    papel_id INTEGER NOT NULL REFERENCES papeis(id),
    matricula_nomus TEXT,
    setor TEXT,
    cargo TEXT,
    ramal TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessoes (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    criado_em TEXT NOT NULL,
    expira_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS avisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    corpo TEXT NOT NULL,
    autor_id INTEGER NOT NULL REFERENCES usuarios(id),
    fixado INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    pasta TEXT NOT NULL DEFAULT 'Geral',
    caminho_arquivo TEXT NOT NULL,
    tamanho INTEGER NOT NULL,
    tipo TEXT,
    enviado_por INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TEXT NOT NULL
  );
`)

/**
 * Chaves de modulo reconhecidas pelo portal (usadas tanto pra montar o menu no cliente
 * quanto pelo middleware exigirModulo() em server/auth.js). 'admin.usuarios' e tratado a
 * parte: so o papel Admin tem, nunca aparece na lista de papeis que um Admin pode montar
 * na tela (ver server/usuarios.js).
 */
export const MODULOS = {
  TERMINAL_APONTAMENTO: 'terminal.apontamento',
  TERMINAL_ACOMPANHAMENTO: 'terminal.acompanhamento',
  TERMINAL_PLANEJAMENTO: 'terminal.planejamento',
  AVISOS: 'avisos',
  DIRETORIO: 'diretorio',
  DOCUMENTOS: 'documentos',
  ADMIN_USUARIOS: 'admin.usuarios',
}

const TODOS_MODULOS = Object.values(MODULOS)

/** Papeis padrao, criados so se a tabela estiver vazia (nao sobrescreve o que o Admin editar depois). */
const PAPEIS_PADRAO = [
  { nome: 'Admin', modulos: TODOS_MODULOS },
  {
    nome: 'Operador',
    modulos: [MODULOS.TERMINAL_APONTAMENTO, MODULOS.TERMINAL_ACOMPANHAMENTO, MODULOS.AVISOS, MODULOS.DIRETORIO],
  },
  {
    nome: 'PCP',
    modulos: [
      MODULOS.TERMINAL_ACOMPANHAMENTO,
      MODULOS.TERMINAL_PLANEJAMENTO,
      MODULOS.AVISOS,
      MODULOS.DIRETORIO,
      MODULOS.DOCUMENTOS,
    ],
  },
  {
    nome: 'Supervisor',
    modulos: [MODULOS.TERMINAL_ACOMPANHAMENTO, MODULOS.AVISOS, MODULOS.DIRETORIO, MODULOS.DOCUMENTOS],
  },
  { nome: 'RH', modulos: [MODULOS.AVISOS, MODULOS.DIRETORIO, MODULOS.DOCUMENTOS] },
]

function semearPapeisPadrao() {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM papeis').get()
  if (total > 0) return

  const inserirPapel = db.prepare('INSERT INTO papeis (nome) VALUES (?)')
  const inserirModulo = db.prepare('INSERT INTO papel_modulos (papel_id, modulo_chave) VALUES (?, ?)')
  for (const papel of PAPEIS_PADRAO) {
    const { lastInsertRowid } = inserirPapel.run(papel.nome)
    for (const modulo of papel.modulos) inserirModulo.run(lastInsertRowid, modulo)
  }
  console.log(`[db] ${PAPEIS_PADRAO.length} papel(is) padrao semeado(s): ${PAPEIS_PADRAO.map((p) => p.nome).join(', ')}`)
}

semearPapeisPadrao()
