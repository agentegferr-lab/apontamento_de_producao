import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { AppError } from './erros.js'

/**
 * Producao de placas de EPS (isopor) — estoque, sem ordem de servico e sem Nomus: cada
 * lancamento e "quem, que tipo de placa, quantos blocos gastou, quantos METROS saiu".
 *
 * Bloco de 1000 x 1200 x 2000 mm. O rendimento por bloco e fixo (trapezio 84 placas de 1 m,
 * telha forro 42 placas de 2 m — 84 m nos dois), entao o esperado de um lancamento e blocos x
 * metros por bloco e a diferenca pro produzido e a perda (refile, quebra). Cada lancamento
 * guarda o esperado e o preco do dia: mudar o bloco ou o preco depois nao reescreve o que ja
 * foi registrado.
 * Mesmo padrao de armazenamento de server/caminhoes.js: JSON local em dados/ (fora do Git),
 * carregado no boot e gravado com .tmp+rename.
 */

// Preco por METRO: trapezio R$ 5,70 (placa de 1 m); forro R$ 9,60 (placa de 2 m = R$ 19,20).
const TRAPEZIO = { familia: 'Trapézio', placasPorBloco: 84, comprimentoM: 1, metrosPorBloco: 84, valorMetro: 5.7 }
const FORRO = { familia: 'Telha forro', placasPorBloco: 42, comprimentoM: 2, metrosPorBloco: 84, valorMetro: 9.6 }

export const TIPOS_EPS = [
  { id: 'TRAPEZIO_TR25', ...TRAPEZIO, perfil: 'TR25', rotulo: 'Trapézio TR25' },
  { id: 'TRAPEZIO_TR40', ...TRAPEZIO, perfil: 'TR40', rotulo: 'Trapézio TR40' },
  { id: 'FORRO_TR25', ...FORRO, perfil: 'TR25', rotulo: 'Telha forro TR25' },
  { id: 'FORRO_TR40', ...FORRO, perfil: 'TR40', rotulo: 'Telha forro TR40' },
]

const centavos = (n) => Math.round(n * 100) / 100

const MAX_BLOCOS = 10_000
const MAX_METROS = 1_000_000
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

/** Esperado, perda (em metros) e rendimento de um lancamento. Pura (o cliente mostra o mesmo calculo ao digitar). */
export function calcularEps(tipo, blocos, metros) {
  const esperado = blocos * tipo.metrosPorBloco
  return {
    esperado,
    diferenca: centavos(metros - esperado), // negativo = perda
    rendimento: esperado > 0 ? metros / esperado : null,
  }
}

/**
 * Lancamentos antigos (de quando se digitava a quantidade de PLACAS) viram metros pelo
 * comprimento da placa do tipo — trapezio 1 m, forro 2 m. O arquivo nao e reescrito.
 */
export function emMetros(item) {
  if (item.unidade === 'm') return item
  const comprimento = tipoPorId(item.tipo)?.comprimentoM ?? 1
  const metros = item.metros ?? item.placas * comprimento
  const esperado = item.esperado * comprimento
  return { ...item, unidade: 'm', metros, esperado, diferenca: centavos(metros - esperado) }
}

/** Metros digitados ("83,5" ou 83.5): zero ou mais, no maximo 2 casas. */
function lerMetros(valor) {
  const texto = String(valor ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) {
    throw new AppError('Informe os metros produzidos (número, com no máximo 2 casas decimais).', 400, 'QUANTIDADE_INVALIDA')
  }
  const n = Number(texto)
  if (n > MAX_METROS) throw new AppError(`Os metros não podem passar de ${MAX_METROS}.`, 400, 'QUANTIDADE_INVALIDA')
  return n
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
    grupo.metros = centavos(grupo.metros + item.metros)
    grupo.esperado += item.esperado
    grupo.valor = centavos(grupo.valor + (item.valor ?? 0))
  }
  const novo = (extra) => ({ ...extra, lancamentos: 0, blocos: 0, metros: 0, esperado: 0, valor: 0 })
  const fechar = (g) => ({
    ...g,
    perda: centavos(g.esperado - g.metros),
    rendimento: g.esperado > 0 ? g.metros / g.esperado : null,
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
    porColaborador: [...porColaborador.values()].map(fechar).sort((a, b) => b.metros - a.metros),
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
      .map(emMetros)
  },

  lancar({ tipo, blocos, metros, colaborador, observacao, data, confirmarExcesso }) {
    const t = tipoPorId(tipo)
    if (!t) throw new AppError('Escolha o tipo de placa.', 400, 'TIPO_INVALIDO')
    const nBlocos = inteiro(blocos, 'Quantidade de blocos', { minimo: 1, maximo: MAX_BLOCOS })
    const nMetros = lerMetros(metros)
    if (data != null && data !== '' && !REGEX_DATA.test(data)) throw new AppError('data deve estar no formato AAAA-MM-DD.', 400)

    const calculo = calcularEps(t, nBlocos, nMetros)
    // Rendimento e fixo: sair MAIS metros do que o bloco da quase sempre e digitacao errada.
    if (nMetros > calculo.esperado && !confirmarExcesso) {
      throw new AppError(
        `${nBlocos} bloco(s) de ${t.rotulo} rendem ${calculo.esperado} m, mas foram informados ${String(nMetros).replace('.', ',')} m. Confira os números.`,
        409,
        'EXCESSO_SOBRE_ESPERADO',
      )
    }

    const registro = {
      id: crypto.randomUUID(),
      tipo: t.id,
      tipoRotulo: t.rotulo,
      blocos: nBlocos,
      unidade: 'm',
      metros: nMetros,
      ...calculo,
      metrosPorBloco: t.metrosPorBloco,
      valorMetro: t.valorMetro,
      valor: centavos(nMetros * t.valorMetro),
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
