/**
 * Desenha o Relatorio de Prazo de Entrega (data prometida no Nomus x data real, por loja) num
 * PDFDocument ja criado — A4 paisagem, ver server/relatorioPrazo.js. Resumo geral e por loja,
 * depois uma secao por loja com cada pedido (atrasados primeiro). Pecas em server/pdfBase.js.
 */
import { criarLayout, dataBr, PRETO, CINZA, VERDE, VERMELHO } from './pdfBase.js'

const dias = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`
const pct = (v) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)

export function textoSituacao(l) {
  if (l.situacao === 'ATRASADO') return { texto: `Atrasado — ${dias(l.diasAtraso)}`, cor: VERMELHO }
  if (l.situacao === 'NO_PRAZO') {
    return { texto: l.diasAntecipado > 0 ? `No prazo — ${dias(l.diasAntecipado)} antes` : 'No prazo — no dia', cor: VERDE }
  }
  return { texto: l.pedidoEncontrado ? 'Sem data prometida' : 'Pedido não encontrado', cor: CINZA }
}

export function gerarPdfPrazo(doc, { periodoRotulo, geradoEm, agrupado, semTabelaDeLojas = false, vendedoresSemLoja = [] }) {
  const L = criarLayout(doc)
  const { largura } = L
  const t = agrupado.total

  L.capa('Relatório de Prazo de Entrega', periodoRotulo, geradoEm)
  L.cartoes([
    ['Pedidos entregues', String(t.pedidos)],
    ['No prazo', `${t.noPrazo} (${pct(t.pctNoPrazo)})`],
    ['Atrasados', `${t.atrasados} (${pct(t.pctAtrasados)})`],
    ['Dias de atraso (soma)', String(t.diasAtrasoTotal)],
    ['Atraso médio', `${t.mediaAtraso.toLocaleString('pt-BR')} dias`],
    ['Maior atraso', dias(t.maiorAtraso)],
  ])

  if (semTabelaDeLojas) {
    L.nota('Atenção: a tabela de vendedores por loja (dados/vendedor-loja.json) não foi encontrada — todos os pedidos aparecem em "Sem loja".', VERMELHO, 9)
  } else if (vendedoresSemLoja.length > 0) {
    L.nota(`Vendedores sem loja na tabela: ${vendedoresSemLoja.join(', ')}.`, CINZA, 8)
  }
  if (t.semPrazo > 0) L.nota(`${t.semPrazo} pedido(s) sem data de entrega prometida no Nomus (ou não encontrados) ficam fora dos percentuais.`, CINZA, 8)
  if (agrupado.repetidos.length > 0) {
    L.nota(`${agrupado.repetidos.length} pedido(s) com mais de um lançamento de entrega no período — vale a PRIMEIRA data: ${agrupado.repetidos.map((r) => `${r.pedido} (${r.lancamentos}x)`).join(', ')}.`, CINZA, 8)
  }

  L.titulo('Resumo por loja', 12)
  const colResumo = [
    { titulo: 'LOJA', largura: 230 },
    { titulo: 'PEDIDOS', largura: 62, alinhar: 'right' },
    { titulo: 'NO PRAZO', largura: 66, alinhar: 'right' },
    { titulo: '% NO PRAZO', largura: 70, alinhar: 'right' },
    { titulo: 'ATRASADOS', largura: 70, alinhar: 'right' },
    { titulo: '% ATRASO', largura: 62, alinhar: 'right' },
    { titulo: 'DIAS DE ATRASO', largura: 80, alinhar: 'right' },
    { titulo: 'MÉDIA (DIAS)', largura: 64, alinhar: 'right' },
    { titulo: 'MAIOR ATRASO', largura: largura - 704, alinhar: 'right' },
  ]
  const linha = (nome, x) => [nome, String(x.pedidos), String(x.noPrazo), pct(x.pctNoPrazo), String(x.atrasados), pct(x.pctAtrasados), String(x.diasAtrasoTotal), x.mediaAtraso.toLocaleString('pt-BR'), dias(x.maiorAtraso)]
  L.tabela(colResumo, [...agrupado.porLoja.map(({ loja, totais }) => linha(loja.nome, totais)), linha('TOTAL', t)], { negritoUltima: true })

  const colPedidos = [
    { titulo: 'PEDIDO', largura: 54 },
    { titulo: 'CLIENTE', largura: 150 },
    { titulo: 'VENDEDOR', largura: 120 },
    { titulo: 'MOTORISTA', largura: 72 },
    { titulo: 'PRAZO PROMETIDO', largura: 84, alinhar: 'right' },
    { titulo: 'ENTREGA REAL', largura: 78, alinhar: 'right' },
    { titulo: 'SITUAÇÃO', largura: largura - 558 },
  ]
  for (const { loja, linhas, totais } of agrupado.porLoja) {
    L.novaPagina()
    L.faixa(loja.nome, `${totais.pedidos} pedido(s) · ${totais.noPrazo} no prazo · ${totais.atrasados} atrasado(s) · ${dias(totais.diasAtrasoTotal)} de atraso`)
    const corpo = linhas.map((l) => [
      l.lancamentos > 1 ? `${l.pedido} *` : l.pedido,
      l.cliente ?? '—',
      l.vendedor ?? (l.pedidoEncontrado ? '—' : 'pedido não encontrado'),
      l.motorista,
      l.prazoIso ? dataBr(l.prazoIso) : '—',
      dataBr(l.dataReal),
      textoSituacao(l),
    ])
    L.tabela(colPedidos, corpo)
  }

  L.nota(
    'Prazo prometido = data de entrega dos itens do pedido no Nomus (a mais tardia); o Nomus guarda só a data atual, então pedidos reprogramados mostram a data reprogramada. Entrega real = primeira entrega lançada do pedido. Dias de atraso são corridos (não úteis). * = pedido lançado mais de uma vez; vale a primeira data.',
    PRETO,
    7.5,
  )
  L.rodape(`GFERRO · Prazo de Entrega · ${periodoRotulo}`)
}
