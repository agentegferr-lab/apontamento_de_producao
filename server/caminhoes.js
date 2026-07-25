import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { AppError } from './erros.js'

/**
 * Cadastro de caminhoes pra tela de Entregas — mesmo padrao de server/pedidosOcultos.js
 * (lista JSON local, carregada uma vez no boot, gravada com .tmp+rename so quando muda).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_CAMINHOES
  ? path.resolve(process.env.ARQUIVO_CAMINHOES)
  : path.join(__dirname, '..', 'dados', 'caminhoes.json')

let itens = []

function carregar() {
  try {
    const bruto = fs.readFileSync(ARQUIVO, 'utf8')
    const dados = JSON.parse(bruto)
    itens = Array.isArray(dados) ? dados : []
    console.log(`[caminhoes] ${itens.length} caminhao(oes) recuperado(s)`)
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.error(`[caminhoes] ARQUIVO ILEGIVEL (${ARQUIVO}) — subindo vazio:`, erro.message)
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

export const caminhoes = {
  listar() {
    return [...itens]
  },

  obter(id) {
    return itens.find((c) => c.id === id) ?? null
  },

  criar({ placa, modelo }) {
    const placaNormalizada = normalizarTexto(placa)
    if (!placaNormalizada) throw new AppError('placa e obrigatoria.', 400)

    const registro = {
      id: crypto.randomUUID(),
      placa: placaNormalizada,
      modelo: normalizarTexto(modelo),
      ativo: true,
      criadoEm: new Date().toISOString(),
    }
    itens.push(registro)
    gravar()
    return registro
  },

  atualizar(id, { placa, modelo, ativo }) {
    const atual = itens.find((c) => c.id === id)
    if (!atual) throw new AppError('Caminhao nao encontrado.', 404)

    if (placa !== undefined) {
      const placaNormalizada = normalizarTexto(placa)
      if (!placaNormalizada) throw new AppError('placa nao pode ficar vazia.', 400)
      atual.placa = placaNormalizada
    }
    if (modelo !== undefined) atual.modelo = normalizarTexto(modelo)
    if (ativo !== undefined) atual.ativo = !!ativo

    gravar()
    return atual
  },
}
