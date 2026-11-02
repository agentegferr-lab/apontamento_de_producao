/**
 * Desenha o Relatorio completo de entregas num PDFDocument ja criado (A4 paisagem, ver
 * server/relatorioEntregas.js). Estrutura: resumo geral + resumo por loja; uma secao por loja
 * (pedidos entregues, vendedor, motorista, valor e recebimento na entrega, com subtotal); e, no
 * final, o resumo por motorista com o total geral. Sem acesso a rede/disco — recebe o dado
 * pronto, entao da pra testar so renderizando. Pecas comuns em server/pdfBase.js.
 */
import { criarLayout, moeda, numero, dataBr, PRETO, CINZA, VERDE, VERMELHO } from './pdfBase.js'

export function textoRecebimento(r) {
  const forma = r.formas?.length ? ` (${r.formas.join(', ')})` : ''
  if (r.situacao === 'RECEBIDO') return `Sim — ${moeda(r.naEntrega)}${forma}`
  if (r.situacao === 'PARCIAL') return `Parcial — ${moeda(r.naEntrega)} de ${moeda(r.cobranca)}`
  if (r.situacao === 'A_RECEBER') return `A receber — ${moeda(r.cobranca)}${forma}`
  if (r.situacao === 'PAGO_ANTES') return 'Não — pago antes'
  return 'Não'
}

const corRecebimento = (situacao) => (situacao === 'RECEBIDO' ? VERDE : situacao === 'A_RECEBER' || situacao === 'PARCIAL' ? VERMELHO : PRETO)

export function gerarPdfEntregasCompleto(doc, { periodoRotulo, geradoEm, agrupado, semTabelaDeLojas = false, vendedoresSemLoja = [] }) {
  const L = criarLayout(doc)
  const { largura } = L
  const t = agrupado.total

  // --- Capa / resumo --------------------------------------------------------------------
  L.capa('Relatório de Entregas', periodoRotulo, geradoEm)
  L.cartoes([
    ['Entregas', String(t.entregas)],
    ['Pedidos', String(t.pedidos)],
    ['Metragem', `${numero(t.metragem)} m²`],
    ['Valor dos pedidos', moeda(t.valorPedidos)],
    ['Recebido na entrega', moeda(t.recebidoNaEntrega)],
    ['Em aberto', moeda(t.emAberto)],
  ])

  if (semTabelaDeLojas) {
    L.nota('Atenção: a tabela de vendedores por loja (dados/vendedor-loja.json) não foi encontrada — todos os pedidos aparecem em "Sem loja".', VERMELHO, 9)
  } else if (vendedoresSemLoja.length > 0) {
    L.nota(`Vendedores sem loja na tabela: ${vendedoresSemLoja.join(', ')}.`, CINZA, 8)
  }

  L.titulo('Resumo por loja', 12)
  const colResumoLoja = [
    { titulo: 'LOJA', largura: 260 },
    { titulo: 'ENTREGAS', largura: 70, alinhar: 'right' },
    { titulo: 'PEDIDOS', largura: 70, alinhar: 'right' },
    { titulo: 'METRAGEM', largura: 80, alinhar: 'right' },
    { titulo: 'VALOR DOS PEDIDOS', largura: 110, alinhar: 'right' },
    { titulo: 'RECEBIDO NA ENTREGA', largura: 110, alinhar: 'right' },
    { titulo: 'EM ABERTO', largura: largura - 700, alinhar: 'right' },
  ]
  const linhasResumoLoja = agrupado.porLoja.map(({ loja, totais }) => [
    loja.nome, String(totais.entregas), String(totais.pedidos), `${numero(totais.metragem)} m²`, moeda(totais.valorPedidos), moeda(totais.recebidoNaEntrega), moeda(totais.emAberto),
  ])
  linhasResumoLoja.push(['TOTAL', String(t.entregas), String(t.pedidos), `${numero(t.metragem)} m²`, moeda(t.valorPedidos), moeda(t.recebidoNaEntrega), moeda(t.emAberto)])
  L.tabela(colResumoLoja, linhasResumoLoja, { negritoUltima: true })

  // --- Uma secao por loja -----------------------------------------------------------------
  const colEntregas = [
    { titulo: 'DATA', largura: 54 },
    { titulo: 'PEDIDO', largura: 46 },
    { titulo: 'CLIENTE', largura: 124 },
    { titulo: 'VENDEDOR', largura: 100 },
    { titulo: 'MOTORISTA', largura: 62 },
    { titulo: 'METRAGEM', largura: 52, alinhar: 'right' },
    { titulo: 'VALOR PEDIDO', largura: 66, alinhar: 'right' },
    { titulo: 'RECEBEU NA ENTREGA?', largura: 140 },
    { titulo: 'REC. ANTES', largura: 62, alinhar: 'right' },
    { titulo: 'EM ABERTO', largura: largura - 706, alinhar: 'right' },
  ]
  for (const { loja, linhas, totais } of agrupado.porLoja) {
    L.novaPagina()
    L.faixa(loja.nome, `${totais.entregas} entrega(s) · ${moeda(totais.valorPedidos)} em pedidos · ${moeda(totais.recebidoNaEntrega)} recebido na entrega`)
    const corpo = linhas.map((l) => [
      dataBr(l.data),
      l.pedido,
      l.cliente ?? '—',
      l.vendedor ?? (l.pedidoEncontrado ? '—' : 'pedido não encontrado'),
      l.motorista,
      l.metragem != null ? `${numero(l.metragem)} m²` : '—',
      l.valorPedido != null ? moeda(l.valorPedido) : '—',
      { texto: textoRecebimento(l.recebimento), cor: corRecebimento(l.recebimento.situacao) },
      l.recebimento.antes > 0 ? moeda(l.recebimento.antes) : '—',
      l.recebimento.emAberto != null ? { texto: moeda(l.recebimento.emAberto), cor: l.recebimento.emAberto > 0.01 ? VERMELHO : PRETO } : '—',
    ])
    corpo.push([
      '', '', `SUBTOTAL · ${totais.pedidos} pedido(s)`, '', '', `${numero(totais.metragem)} m²`, moeda(totais.valorPedidos),
      `${moeda(totais.recebidoNaEntrega)} · ${totais.comRecebimentoNaEntrega} ped.`, '', moeda(totais.emAberto),
    ])
    L.tabela(colEntregas, corpo, { negritoUltima: true })
  }

  // --- Resumo por motorista (final) -----------------------------------------------------------
  L.novaPagina()
  L.faixa('Resumo por motorista', `${agrupado.porMotorista.length} motorista(s)`)
  const colMotorista = [
    { titulo: 'MOTORISTA', largura: 170 },
    { titulo: 'ENTREGAS', largura: 60, alinhar: 'right' },
    { titulo: 'PEDIDOS', largura: 60, alinhar: 'right' },
    { titulo: 'METRAGEM', largura: 80, alinhar: 'right' },
    { titulo: 'VALOR DOS PEDIDOS', largura: 110, alinhar: 'right' },
    { titulo: 'C/ RECEBIMENTO', largura: 80, alinhar: 'right' },
    { titulo: 'RECEBIDO NA ENTREGA', largura: 110, alinhar: 'right' },
    { titulo: 'EM ABERTO', largura: largura - 670, alinhar: 'right' },
  ]
  const corpoMotorista = agrupado.porMotorista.map(({ motorista, totais }) => [
    motorista, String(totais.entregas), String(totais.pedidos), `${numero(totais.metragem)} m²`, moeda(totais.valorPedidos), String(totais.comRecebimentoNaEntrega), moeda(totais.recebidoNaEntrega), moeda(totais.emAberto),
  ])
  corpoMotorista.push(['TOTAL GERAL', String(t.entregas), String(t.pedidos), `${numero(t.metragem)} m²`, moeda(t.valorPedidos), String(t.comRecebimentoNaEntrega), moeda(t.recebidoNaEntrega), moeda(t.emAberto)])
  L.tabela(colMotorista, corpoMotorista, { negritoUltima: true })
  L.nota(
    '“Recebeu na entrega?”: parcelas do pedido marcadas ENTREGA no Nomus (valor e forma de pagamento) cruzadas com o contas a receber — “Sim” = já baixada, “A receber” = cobrança na entrega ainda sem baixa; pedido sem parcela ENTREGA usa as baixas lançadas no dia da entrega. “Rec. antes” = demais recebimentos (entrada, pago antecipado). “Em aberto” = valor do pedido menos tudo que já foi recebido.',
  )

  L.rodape(`GFERRO · Relatório de Entregas · ${periodoRotulo}`)
}
