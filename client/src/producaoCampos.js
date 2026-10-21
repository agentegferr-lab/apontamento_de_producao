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

/** Dias "AAAA-MM-DD" de `inicio` a `fim`, inclusive. */
export function diasDoPeriodo(inicio, fim) {
  const [ai, mi, di] = inicio.split('-').map(Number)
  const [af, mf, df] = fim.split('-').map(Number)
  const dias = []
  for (let d = new Date(ai, mi - 1, di); d <= new Date(af, mf - 1, df); d.setDate(d.getDate() + 1)) dias.push(chaveData(d))
  return dias
}

/** "27/07/2026 17:53:07" -> 17. null se nao der pra ler. */
function horaDoNomus(dataHoraNomus) {
  const m = /\s(\d{2}):\d{2}/.exec(String(dataHoraNomus ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * Serie ACUMULADA pro grafico de linhas do relatorio: quanto ja foi produzido ate cada ponto
 * do periodo, pra comparar com a meta (a linha so sobe; cruzou a meta = atingida).
 *
 * `modo` define o eixo X: "dia" -> uma coluna por hora; "semana"/"mes" -> uma por dia. Pontos
 * ainda no futuro (depois de `agora`) saem `null`, pra a linha parar no presente em vez de
 * seguir reta ate o fim do periodo.
 *
 * `tipo` "quantidade" soma `quantidade` (so da `unidade` pedida, quando informada — nunca
 * mistura m² com unidade); "moeda" soma `valorProduzido` (estimado, ver server/relatorioProducao.js).
 * `centro` vazio/null = todos os centros.
 */
export function serieAcumuladaPorPeriodo(detalhado, { centro, inicio, fim, modo, tipo = 'quantidade', unidade, agora = new Date() }) {
  const valorDe = (d) => {
    if (tipo === 'moeda') return d.valorProduzido ?? null
    if (d.quantidade == null) return null
    if (unidade && d.unidadeMedida !== unidade) return null
    return d.quantidade
  }
  const itens = (detalhado ?? [])
    .filter((d) => !centro || d.centro === centro)
    .map((d) => ({ chave: chaveDoDiaNomus(d.dataHoraFinal), hora: horaDoNomus(d.dataHoraFinal), valor: valorDe(d) }))
    .filter((d) => d.valor != null && d.valor > 0 && d.chave)
  const hojeChave = chaveData(agora)

  if (modo === 'dia') {
    const doDia = itens.filter((d) => d.chave === inicio && d.hora != null)
    const horas = doDia.map((d) => d.hora)
    const de = Math.min(6, ...horas)
    const ate = Math.max(18, ...horas)
    const rotulos = []
    const pontos = []
    let acumulado = 0
    for (let h = de; h <= ate; h++) {
      acumulado += doDia.filter((d) => d.hora === h).reduce((soma, d) => soma + d.valor, 0)
      const futuro = inicio > hojeChave || (inicio === hojeChave && h > agora.getHours())
      rotulos.push(`${h}h`)
      pontos.push(futuro ? null : acumulado)
    }
    return { rotulos, pontos }
  }

  const dias = diasDoPeriodo(inicio, fim)
  const porDia = new Map(dias.map((d) => [d, 0]))
  for (const d of itens) if (porDia.has(d.chave)) porDia.set(d.chave, porDia.get(d.chave) + d.valor)
  let acumulado = 0
  const rotulos = dias.map((d) => (modo === 'mes' ? String(Number(d.slice(8))) : `${d.slice(8)}/${d.slice(5, 7)}`))
  const pontos = dias.map((d) => {
    acumulado += porDia.get(d)
    return d > hojeChave ? null : acumulado
  })
  return { rotulos, pontos }
}

/** Valor de eixo "redondo" (1, 2, 2,5, 5 x 10^k) >= `max`, pra os rotulos do eixo Y nao ficarem quebrados. */
export function maximoRedondo(max) {
  if (!(max > 0)) return 1
  const potencia = 10 ** Math.floor(Math.log10(max))
  for (const passo of [1, 2, 2.5, 5, 10]) if (passo * potencia >= max) return passo * potencia
  return 10 * potencia
}

/** Rotulo curto de eixo: 45000 -> "45 mil", 2400000 -> "2,4 mi". */
export function abreviarNumero(n) {
  const abs = Math.abs(n)
  const fmt = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  if (abs >= 1_000_000) return `${fmt(n / 1_000_000)} mi`
  if (abs >= 1_000) return `${fmt(n / 1_000)} mil`
  return fmt(n)
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

/**
 * Soma o valor estimado (rateado do pedido, ver server/relatorioProducao.js) de todos os
 * centros do periodo — null quando NENHUM centro tem valor resolvido ainda (pedido nao
 * encontrado/ainda em cache), pra distinguir de "somou e deu zero".
 */
export function somarValorProduzido(porCentro) {
  const comValor = (porCentro ?? []).filter((c) => c.valorProduzido != null)
  if (comValor.length === 0) return null
  return comValor.reduce((soma, c) => soma + c.valorProduzido, 0)
}

/**
 * Metas mensais de producao, combinadas com o usuario em 2026-08-13 (atualizadas em 2026-10-19: Corte 45 mil, Colagem 20 mil, faturamento/Logistica R$ 2,4 mi) — nao vem do Nomus (o
 * ERP nao tem conceito de meta, so o que foi de fato apontado). Corte/Pintura/Colagem em m²
 * (mesma unidade do numero principal do card, ver quantidadePrincipal); Logística em R$
 * (mesma unidade da caixa "estimado" que ela substitui, ja que logística nao tem uma
 * quantidade fisica unica pra comparar). Centro sem entrada aqui mantem a caixa de "R$
 * estimado" de sempre — ver TelaRelatorioProducao.jsx.
 */
const METAS_MENSAIS = {
  CORTE: { valor: 45_000, tipo: 'quantidade' },
  PINTURA: { valor: 22_000, tipo: 'quantidade' },
  COLAGEM: { valor: 20_000, tipo: 'quantidade' },
  'LOGÍSTICA': { valor: 2_400_000, tipo: 'moeda' }, // faturamento
}
const DIAS_UTEIS_MES = 22

/**
 * Meta do centro escalada pro periodo selecionado (modo do segmentado Dia/Semana/Mês) — a
 * mensal (METAS_MENSAIS) vira diaria dividindo por DIAS_UTEIS_MES; semana assume 5 dias
 * uteis FIXOS (nao conta quantos dias uteis a semana escolhida realmente tem, nem feriado);
 * mes usa a mensal cheia. `null` se o centro nao tem meta definida.
 */
export function metaDoPeriodo(centro, modo) {
  const meta = METAS_MENSAIS[centro]
  if (!meta) return null
  const diaria = meta.valor / DIAS_UTEIS_MES
  const valor = modo === 'dia' ? diaria : modo === 'semana' ? diaria * 5 : meta.valor
  return { tipo: meta.tipo, valor }
}

/** % da meta ja atingido no periodo — 0 (nao null) quando a meta e 0, so pra nunca dividir
 * por zero; nao deveria acontecer com os valores fixos de METAS_MENSAIS acima. */
export function progressoMeta(atual, metaValor) {
  if (!metaValor) return 0
  return ((atual ?? 0) / metaValor) * 100
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
 *
 * "Valor estimado" e o valor do pedido rateado pela quantidade produzida em cada apontamento
 * (ver server/relatorioProducao.js) — nao e um valor exato do Nomus, por isso o rotulo deixa
 * isso explicito. Fica vazio quando a OS nao tem pedido/valor resolvido.
 */
export function gerarCsvRelatorioProducao(linhas) {
  const cabecalho = ['Data/hora final', 'Centro de trabalho', 'OS', 'Etapa', 'Quantidade', 'Unidade', 'Colaborador', 'Duração', 'Valor estimado (R$)']
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
      d.valorProduzido != null ? d.valorProduzido.toFixed(2).replace('.', ',') : '',
    ]
      .map(escaparCsv)
      .join(';'),
  )
  return '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n')
}
