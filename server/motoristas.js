import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { AppError } from './erros.js'

/**
 * Cadastro de motoristas pra tela de Entregas — mesmo padrao de server/pedidosOcultos.js.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_MOTORISTAS
  ? path.resolve(process.env.ARQUIVO_MOTORISTAS)
  : path.join(__dirname, '..', 'dados', 'motoristas.json')

let itens = []

function carregar() {
  try {
    const bruto = fs.readFileSync(ARQUIVO, 'utf8')
    const dados = JSON.parse(bruto)
    itens = Array.isArray(dados) ? dados : []
    console.log(`[motoristas] ${itens.length} motorista(s) recuperado(s)`)
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.error(`[motoristas] ARQUIVO ILEGIVEL (${ARQUIVO}) — subindo vazio:`, erro.message)
    }
    itens = []
  }
}

function gravar() {
  const temporario = `${ARQUIVO}.tmp`
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
  fs.writeFileSync(temporario, JSON.stringify(itens, null, 2), 'utf8')
  fs.renameSync(temporario, ARQUIVO)
}

carregar()

function normalizarTexto(valor) {
  const t = String(valor ?? '').trim()
  return t || null
}

export const motoristas = {
  listar() {
    return [...itens]
  },

  obter(id) {
    return itens.find((m) => m.id === id) ?? null
  },

  criar({ nome }) {
    const nomeNormalizado = normalizarTexto(nome)
    if (!nomeNormalizado) throw new AppError('nome e obrigatorio.', 400)

    const registro = {
      id: crypto.randomUUID(),
      nome: nomeNormalizado,
      ativo: true,
      criadoEm: new Date().toISOString(),
    }
    itens.push(registro)
    gravar()
    return registro
  },

  atualizar(id, { nome, ativo }) {
    const atual = itens.find((m) => m.id === id)
    if (!atual) throw new AppError('Motorista nao encontrado.', 404)

    if (nome !== undefined) {
      const nomeNormalizado = normalizarTexto(nome)
      if (!nomeNormalizado) throw new AppError('nome nao pode ficar vazio.', 400)
      atual.nome = nomeNormalizado
    }
    if (ativo !== undefined) atual.ativo = !!ativo

    gravar()
    return atual
  },
}
