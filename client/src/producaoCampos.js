/**
 * Funcoes puras da tela de Relatorio de Producao (client/src/components/TelaRelatorioProducao.jsx)
 * — calculo de periodo (dia/semana/mes), formatacao de duracao e exportacao em CSV. Mesmo
 * padrao de entregasCampos.js/planejamentoCampos.js: cada tela tem seu proprio arquivo, sem
 * um "campos.js" compartilhado.
 */

function chaveData(data) {
  const p = (n) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`
}

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

/** Mesma semantica de entregasCampos.js: { inicio, fim } em "AAAA-MM-DD" + `rotulo` pra exibir. */
export function intervaloDoPeriodo(modo, referencia) {
  if (modo === 'dia') {
    const chave = chaveData(referencia)
    return { inicio: chave, fim: chave, rotulo: referencia.toLocaleDateString('pt-BR', { dateStyle: 'long' }) }
  }
  if (modo === 'semana') {
    const inicio = inicioDaSemana(referencia)
    const fim = new Date(inicio)
    fim.setDate(fim.getDate() + 6)
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

export function navegarPeriodo(modo, referencia, delta) {
  const d = new Date(referencia)
  if (modo === 'dia') d.setDate(d.getDate() + delta)
  else if (modo === 'semana') d.setDate(d.getDate() + delta * 7)
  else d.setMonth(d.getMonth() + delta)
  return d
}

/** ms -> "1h30" / "45min" / "2h" — formato compacto pras colunas de duracao. */
export function formatarDuracao(ms) {
  const totalMin = Math.round((ms ?? 0) / 60_000)
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (h === 0) return `${min}min`
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

function escaparCsv(valor) {
  const texto = String(valor ?? '')
  return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/**
 * CSV pronto pra abrir no Excel em pt-BR: BOM UTF-8, `;` como separador, quantidade com
 * virgula decimal (o Nomus ja manda data/hora em DD/MM/AAAA, entao dataHoraFinal vai direto).
 */
export function gerarCsvRelatorioProducao(linhas) {
  const cabecalho = ['Data/hora final', 'Centro de trabalho', 'OS', 'Etapa', 'Quantidade', 'Unidade', 'Colaborador', 'Duração']
  const corpo = linhas.map((d) =>
    [
      d.dataHoraFinal ?? '',
      d.centro,
      d.nomeOrdem ?? '',
      d.descricaoEtapa ?? '',
      d.quantidade != null ? String(d.quantidade).replace('.', ',') : '',
      d.unidadeMedida ?? '',
      d.funcionario ?? '',
      formatarDuracao(d.duracaoMs),
    ]
      .map(escaparCsv)
      .join(';'),
  )
  return '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n')
}
