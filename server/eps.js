import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { AppError } from './erros.js'

/**
 * Producao de placas de EPS (isopor) — estoque, sem ordem de servico e sem Nomus: cada
 * lancamento e "quem, que tipo de placa, quantos blocos gastou, quantas placas saiu".
 *
 * O rendimento por bloco e fixo (trapezio 40 placas, telha forro 20), entao o esperado de um
 * lancamento e blocos x rendimento e a diferenca pro produzido e a perda (refile, quebra).
 * Mesmo padrao de armazenamento de server/caminhoes.js: JSON local em dados/ (fora do Git),
 * carregado no boot e gravado com .tmp+rename.
 */

export const TIPOS_EPS = [
  { id: 'TRAPEZIO_TR25', familia: 'Trapézio', perfil: 'TR25', rotulo: 'Trapézio TR25', placasPorBloco: 40 },
  { id: 'TRAPEZIO_TR40', familia: 'Trapézio', perfil: 'TR40', rotulo: 'Trapézio TR40', placasPorBloco: 40 },
  { id: 'FORRO_TR25', familia: 'Telha forro', perfil: 'TR25', rotulo: 'Telha forro TR25', placasPorBloco: 20 },
  { id: 'FORRO_TR40', familia: 'Telha forro', perfil: 'TR40', rotulo: 'Telha forro TR40', placasPorBloco: 20 },
]

const MAX_BLOCOS = 10_000
const MAX_PLACAS = 1_000_000
const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_EPS
  ? path.resolve(process.env.ARQUIVO_EPS)
  : path.join(__dirname, '..', 'dados', 'eps.json')

let itens = []

function carregar() {
  try {
    const dados = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'))
    itens = Array.isArray(dados) ? dados : []
    console.log(`[eps] ${itens.length} lancamento(s) recuperado(s)`)
  } catch (erro) {
    if (erro.code !== 'ENOENT') console.error(`[eps] ARQUIVO ILEGIVEL (${ARQUIVO}) — subindo vazio:`, erro.message)
    itens = []
  }
}

function gravar() {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
  fs.writeFileSync(`${ARQUIVO}.tmp`, JSON.stringify(itens, null, 2), 'utf8')
  fs.renameSync(`${ARQUIVO}.tmp`, ARQUIVO)
}

carregar()

export function tipoPorId(id) {
  return TIPOS_EPS.find((t) => t.id === id) ?? null
}

/** Esperado, perda e rendimento de um lancamento. Pura (o cliente mostra o mesmo calculo ao digitar). */
export function calcularEps(tipo, blocos, placas) {
  const esperado = blocos * tipo.placasPorBloco
  return {
    esperado,
    diferenca: placas - esperado, // negativo = perda
    rendimento: esperado > 0 ? placas / esperado : null,
  }
}

function inteiro(valor, nome, { minimo, maximo }) {
  const n = Number(String(valor ?? '').replace(',', '.'))
  if (!Number.isInteger(n)) throw new AppError(`${nome} deve ser um número inteiro.`, 400, 'QUANTIDADE_INVALIDA')
  if (n < minimo) throw new AppError(`${nome} deve ser pelo menos ${minimo}.`, 400, 'QUANTIDADE_INVALIDA')
  if (n > maximo) throw new AppError(`${nome} não pode passar de ${maximo}.`, 400, 'QUANTIDADE_INVALIDA')
  return n
}

function dataDeHoje() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Totais, rendimento e quebra por tipo, por colaborador e por dia de uma lista de lancamentos. */
export function resumirEps(lista) {
  const somar = (grupo, item) => {
    grupo.lancamentos += 1
    grupo.blocos += item.blocos
    grupo.placas += item.placas
    grupo.esperado += item.esperado
  }
  const novo = (extra) => ({ ...extra, lancamentos: 0, blocos: 0, placas: 0, esperado: 0 })
  const fechar = (g) => ({
    ...g,
    perda: g.esperado - g.placas,
    rendimento: g.esperado > 0 ? g.placas / g.esperado : null,
  })

  const total = novo({})
  const porTipo = new Map(TIPOS_EPS.map((t) => [t.id, novo({ tipo: t.id, rotulo: t.rotulo })]))
  const porColaborador = new Map()
  const porDia = new Map()

  for (const item of lista) {
    somar(total, item)
    if (!porTipo.has(item.tipo)) porTipo.set(item.tipo, novo({ tipo: item.tipo, rotulo: item.tipoRotulo }))
    somar(porTipo.get(item.tipo), item)
    const chave = item.colaborador?.matricula ?? item.colaborador?.nome ?? '?'
    if (!porColaborador.has(chave)) porColaborador.set(chave, novo({ nome: item.colaborador?.nome ?? chave, matricula: item.colaborador?.matricula ?? null }))
    somar(porColaborador.get(chave), item)
    if (!porDia.has(item.data)) porDia.set(item.data, novo({ data: item.data }))
    somar(porDia.get(item.data), item)
  }

  return {
    total: fechar(total),
    porTipo: [...porTipo.values()].filter((g) => g.lancamentos > 0).map(fechar),
    porColaborador: [...porColaborador.values()].map(fechar).sort((a, b) => b.placas - a.placas),
    porDia: [...porDia.values()].map(fechar).sort((a, b) => a.data.localeCompare(b.data)),
  }
}

export const eps = {
  tipos() {
    return TIPOS_EPS
  },

  /** Lancamentos ativos de [inicio, fim] (AAAA-MM-DD, inclusivos), mais recentes primeiro. */
  listar({ inicio, fim } = {}) {
    const de = inicio || dataDeHoje()
    const ate = fim || de
    if (!REGEX_DATA.test(de) || !REGEX_DATA.test(ate)) throw new AppError('inicio e fim devem estar no formato AAAA-MM-DD.', 400)
    return itens
      .filter((i) => !i.cancelado && i.data >= de && i.data <= ate)
      .sort((a, b) => b.em.localeCompare(a.em))
  },

  lancar({ tipo, blocos, placas, colaborador, observacao, data, confirmarExcesso }) {
    const t = tipoPorId(tipo)
    if (!t) throw new AppError('Escolha o tipo de placa.', 400, 'TIPO_INVALIDO')
    const nBlocos = inteiro(blocos, 'Quantidade de blocos', { minimo: 1, maximo: MAX_BLOCOS })
    const nPlacas = inteiro(placas, 'Quantidade de placas', { minimo: 0, maximo: MAX_PLACAS })
    if (data != null && data !== '' && !REGEX_DATA.test(data)) throw new AppError('data deve estar no formato AAAA-MM-DD.', 400)

    const calculo = calcularEps(t, nBlocos, nPlacas)
    // Rendimento e fixo: sair MAIS placas do que o bloco da quase sempre e digitacao errada.
    if (nPlacas > calculo.esperado && !confirmarExcesso) {
      throw new AppError(
        `${nBlocos} bloco(s) de ${t.rotulo} rendem ${calculo.esperado} placas, mas foram informadas ${nPlacas}. Confira os números.`,
        409,
        'EXCESSO_SOBRE_ESPERADO',
      )
    }

    const registro = {
      id: crypto.randomUUID(),
      tipo: t.id,
      tipoRotulo: t.rotulo,
      blocos: nBlocos,
      placas: nPlacas,
      ...calculo,
      colaborador: { id: colaborador?.id ?? null, nome: colaborador?.nome ?? null, matricula: colaborador?.matricula ?? null },
      observacao: String(observacao ?? '').trim() || null,
      data: data || dataDeHoje(),
      em: new Date().toISOString(),
      cancelado: false,
    }
    itens.push(registro)
    gravar()
    return registro
  },

  /** Cancela (nao apaga: fica na auditoria) um lancamento digitado errado. */
  cancelar(id, { por } = {}) {
    const atual = itens.find((i) => i.id === id && !i.cancelado)
    if (!atual) throw new AppError('Lançamento não encontrado.', 404)
    atual.cancelado = true
    atual.canceladoEm = new Date().toISOString()
    atual.canceladoPor = por ?? null
    gravar()
    return atual
  },
}
