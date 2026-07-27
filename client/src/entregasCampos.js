/**
 * Funcoes puras da tela de Entregas (client/src/components/TelaEntregas.jsx) — calculo de
 * periodo (dia/semana/mes), agregacao do relatorio, busca/filtro/paginacao da listagem e
 * exportacao em CSV. Separadas do componente pra testar sem precisar montar React (mesmo
 * padrao de planejamentoCampos.js/kanbanCampos.js).
 */

import { formatarNumeroBr, formatarMoedaNumero } from './numero.js'
import { formatarDataBr } from './planejamentoCampos.js'

function chaveData(data) {
  const p = (n) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`
}

/** Domingo da semana que contem `data` (0 = domingo, mesma convencao do calendario do Planejamento). */
function inicioDaSemana(data) {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate())
  d.setDate(d.getDate() - d.getDay())
  return d
}

const NOME_MES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function rotuloDia(d) {
  return `${d.getDate()} de ${NOME_MES[d.getMonth()]} de ${d.getFullYear()}`
}
function rotuloDiaSemAno(d) {
  return `${d.getDate()} de ${NOME_MES[d.getMonth()]}`
}

/**
 * Devolve { inicio, fim } (chaves "AAAA-MM-DD", inclusive dos dois lados) e um `rotulo` pra
 * exibir, pro modo e data de referencia dados. "Semana" e domingo a sabado da semana que
 * contem a referencia; "mes" e o mes calendario inteiro.
 */
export function intervaloDoPeriodo(modo, referencia) {
  if (modo === 'dia') {
    const chave = chaveData(referencia)
    return { inicio: chave, fim: chave, rotulo: referencia.toLocaleDateString('pt-BR', { dateStyle: 'long' }) }
  }
  if (modo === 'semana') {
    const inicio = inicioDaSemana(referencia)
    const fim = new Date(inicio)
    fim.setDate(fim.getDate() + 6)
    // Mesmo ano: omite o ano na primeira data ("19 de julho a 25 de julho de 2026") — repetir
    // o ano duas vezes ficaria redundante no espaço curto do controle de período.
    const rotulo =
      inicio.getFullYear() === fim.getFullYear()
        ? `${rotuloDiaSemAno(inicio)} a ${rotuloDia(fim)}`
        : `${rotuloDia(inicio)} a ${rotuloDia(fim)}`
    return { inicio: chaveData(inicio), fim: chaveData(fim), rotulo }
  }
  const inicio = new Date(referencia.getFullYear(), referencia.getMonth(), 1)
  const fim = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0)
  return { inicio: chaveData(inicio), fim: chaveData(fim), rotulo: `${NOME_MES[referencia.getMonth()]} de ${referencia.getFullYear()}` }
}

/** Move a data de referencia pra frente/tras conforme o modo (1 dia, 1 semana ou 1 mes por vez). */
export function navegarPeriodo(modo, referencia, delta) {
  const d = new Date(referencia)
  if (modo === 'dia') d.setDate(d.getDate() + delta)
  else if (modo === 'semana') d.setDate(d.getDate() + delta * 7)
  else d.setMonth(d.getMonth() + delta)
  return d
}

/** `entregas` com `data` dentro de [inicio, fim] (comparacao de string, chaves "AAAA-MM-DD"). */
export function filtrarPorPeriodo(entregas, { inicio, fim }) {
  return entregas.filter((e) => e.data >= inicio && e.data <= fim)
}

/** Quantos pedidos cada motorista entregou no periodo, do que mais entregou pro que menos. */
export function agruparPorMotorista(entregasFiltradas, motoristas) {
  const nomePorId = new Map(motoristas.map((m) => [m.id, m.nome]))
  const contagem = new Map()
  for (const e of entregasFiltradas) {
    contagem.set(e.motoristaId, (contagem.get(e.motoristaId) ?? 0) + 1)
  }
  return [...contagem.entries()]
    .map(([motoristaId, total]) => ({ motoristaId, nome: nomePorId.get(motoristaId) ?? 'Motorista removido', total }))
    .sort((a, b) => b.total - a.total)
}

/** Soma metragem/valor do periodo — `metragem`/`valor` sao opcionais (null quando o
 * motorista nao informou), entao null/undefined simplesmente nao entram na soma. */
export function somarTotais(entregasFiltradas) {
  let metragem = 0
  let valor = 0
  for (const e of entregasFiltradas) {
    if (e.metragem != null) metragem += e.metragem
    if (e.valor != null) valor += e.valor
  }
  return { metragem, valor }
}

/** Motoristas com ativo=true — usado no card "Motoristas ativos" do relatorio. */
export function motoristasAtivos(motoristas) {
  return motoristas.filter((m) => m.ativo)
}

/** Plural simples pt-BR: 1 usa a forma singular, qualquer outro numero (inclusive 0) usa a plural. */
export function pluralizar(n, singular, plural) {
  return n === 1 ? singular : plural
}

/** Texto do cabecalho da listagem: "Nenhum registro encontrado" / "1 registro encontrado" / "N registros encontrados". */
export function textoRegistros(n) {
  if (n === 0) return 'Nenhum registro encontrado'
  return `${n} ${pluralizar(n, 'registro encontrado', 'registros encontrados')}`
}

/** "247,2 m²" — formatacao de metragem centralizada (evita repetir o sufixo em varios lugares). */
export function formatarMetragem(numero) {
  return `${formatarNumeroBr(numero)} m²`
}

/** Busca do cabecalho da listagem: casa por CLIENTE ou por PEDIDO (case-insensitive, substring).
 * Termo vazio/so espaco devolve tudo sem filtrar. */
export function filtrarPorBusca(entregas, termo) {
  const alvo = (termo ?? '').trim().toLowerCase()
  if (!alvo) return entregas
  return entregas.filter(
    (e) => (e.cliente ?? '').toLowerCase().includes(alvo) || e.pedido.toLowerCase().includes(alvo),
  )
}

/** Filtros do botao "Filtros" (motorista/caminhao) — id vazio/ausente em qualquer um dos dois
 * significa "todos", nao restringe por aquele campo. */
export function filtrarPorSelecao(entregas, { motoristaId, caminhaoId } = {}) {
  return entregas.filter(
    (e) => (!motoristaId || e.motoristaId === motoristaId) && (!caminhaoId || e.caminhaoId === caminhaoId),
  )
}

/** Paginacao local — o backend de GET /api/entregas ainda devolve tudo de uma vez, sem
 * parametro de pagina, entao a pagina é fatiada aqui. `pagina` fora do intervalo e ajustada
 * pro limite valido mais proximo (nunca devolve uma pagina vazia por engano). */
export function paginar(itens, pagina, tamanhoPagina) {
  const total = itens.length
  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina))
  const paginaValida = Math.min(Math.max(1, pagina), totalPaginas)
  const inicio = (paginaValida - 1) * tamanhoPagina
  return { pagina: paginaValida, totalPaginas, total, itens: itens.slice(inicio, inicio + tamanhoPagina) }
}

function escaparCsv(valor) {
  const texto = String(valor ?? '')
  return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/**
 * CSV pronto pra abrir no Excel em pt-BR: BOM UTF-8 (acentos nao corrompem), `;` como
 * separador (o Excel BR usa `,` como separador decimal, entao `;` evita confundir coluna com
 * casa decimal), datas dd/MM/aaaa, moeda "R$ 1.234,56". `nomeMotorista`/`placaCaminhao` sao
 * Map(id -> texto), o mesmo que o componente ja monta pra exibir a tabela.
 */
export function gerarCsvEntregas(linhas, { nomeMotorista, placaCaminhao }) {
  const cabecalho = ['Data', 'Motorista', 'Caminhão', 'Pedido', 'Cliente', 'Metragem (m²)', 'Valor', 'Status']
  const corpo = linhas.map((e) =>
    [
      formatarDataBr(e.data),
      nomeMotorista.get(e.motoristaId) ?? '—',
      placaCaminhao.get(e.caminhaoId) ?? '—',
      e.pedido,
      e.cliente ?? '—',
      e.metragem != null ? formatarNumeroBr(e.metragem) : '—',
      e.valor != null ? formatarMoedaNumero(e.valor) : '—',
      'Entregue',
    ]
      .map(escaparCsv)
      .join(';'),
  )
  return '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n')
}
