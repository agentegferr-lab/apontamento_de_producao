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

/** A quantidade "principal" de um centro pros graficos/card/tendencia: a unidade com maior
 * total (na pratica quase sempre so tem uma). null se o centro nao produziu nada no periodo. */
export function quantidadePrincipal(quantidades) {
  if (!quantidades || quantidades.length === 0) return null
  return quantidades.reduce((maior, atual) => (atual.total > maior.total ? atual : maior))
}

/**
 * Variacao percentual entre o total do periodo atual e o do periodo equivalente anterior
 * (mesmo modo — ex.: dia contra o dia anterior). 'novo' quando nao tinha nada antes mas
 * passou a ter agora (percentual nao faz sentido matematico partindo de zero). 'estavel'
 * quando os dois sao zero, ou a diferenca fica abaixo de 0,5%.
 */
export function calcularTendencia(atual, anterior) {
  if (anterior === 0) {
    if (atual === 0) return { percentual: 0, direcao: 'estavel' }
    return { percentual: null, direcao: 'novo' }
  }
  const percentual = ((atual - anterior) / anterior) * 100
  if (Math.abs(percentual) < 0.5) return { percentual: 0, direcao: 'estavel' }
  return { percentual, direcao: percentual > 0 ? 'alta' : 'baixa' }
}

/** "27/07/2026 17:53:07" (formato do Nomus) -> "2026-07-27" — so a data, pra bucketizar por dia. */
export function chaveDoDiaNomus(dataHoraNomus) {
  const [dataParte] = String(dataHoraNomus ?? '').split(' ')
  const [d, m, a] = dataParte.split('/')
  if (!d || !m || !a) return null
  return `${a}-${m}-${d}`
}

/** As ultimas `quantidade` chaves de dia ("AAAA-MM-DD"), terminando (inclusive) em `fimChave`
 * ("AAAA-MM-DD") — janela fixa do "sparkline" dos cards, independente do modo selecionado. */
export function ultimosDias(fimChave, quantidade) {
  const [a, m, d] = fimChave.split('-').map(Number)
  const fim = new Date(a, m - 1, d)
  const p = (n) => String(n).padStart(2, '0')
  return Array.from({ length: quantidade }, (_, i) => {
    const dia = new Date(fim)
    dia.setDate(dia.getDate() - (quantidade - 1 - i))
    return `${dia.getFullYear()}-${p(dia.getMonth() + 1)}-${p(dia.getDate())}`
  })
}

/**
 * Soma a quantidade de todos os apontamentos de `centro` em cada dia de `diasChaves` — pro
 * "sparkline" dos cards. Mistura unidades diferentes sem distinguir (e so uma linha de
 * tendencia decorativa; o valor preciso por unidade continua so no card/tabela/graficos).
 */
export function serieDiariaPorCentro(detalhado, centro, diasChaves) {
  const porDia = new Map(diasChaves.map((d) => [d, 0]))
  for (const item of detalhado) {
    if (item.centro !== centro || item.quantidade == null) continue
    const chave = chaveDoDiaNomus(item.dataHoraFinal)
    if (porDia.has(chave)) porDia.set(chave, porDia.get(chave) + item.quantidade)
  }
  return diasChaves.map((d) => porDia.get(d))
}

/** Paginacao local — mesmo padrao de entregasCampos.js (o /api/relatorio-producao tambem
 * devolve tudo de uma vez, sem parametro de pagina). */
export function paginar(itens, pagina, tamanhoPagina) {
  const total = itens.length
  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina))
  const paginaValida = Math.min(Math.max(1, pagina), totalPaginas)
  const inicio = (paginaValida - 1) * tamanhoPagina
  return { pagina: paginaValida, totalPaginas, total, itens: itens.slice(inicio, inicio + tamanhoPagina) }
}

/** Paleta fixa (nao semantica — nao e verde=ok/vermelho=erro) pra identificar cada centro nos
 * graficos/cards, na mesma ordem que ja vem do servidor (fluxo fisico: Corte, Pintura...). */
const PALETA_CENTROS = ['#16a34a', '#2563eb', '#ea580c', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#d97706']
export function corDoCentro(indice) {
  return PALETA_CENTROS[indice % PALETA_CENTROS.length]
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
