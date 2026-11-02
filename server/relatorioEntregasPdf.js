/**
 * Desenha o Relatorio completo de entregas num PDFDocument ja criado (A4 paisagem, ver
 * server/relatorioEntregas.js). Estrutura: resumo geral + resumo por loja; uma secao por loja
 * (pedidos entregues, vendedor, motorista, valor e recebimento na entrega, com subtotal); e, no
 * final, o resumo por motorista com o total geral. Sem acesso a rede/disco — recebe o dado
 * pronto, entao da pra testar so renderizando.
 */

const PRETO = '#1c1a1a'
const AMARELO = '#FFD60A'
const CINZA = '#6b6b6b'
const LINHA = '#d9d9d9'
const VERDE = '#15803d'
const VERMELHO = '#b91c1c'

const moeda = (n) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ')
const numero = (n) => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const dataBr = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

/** Corta o texto (com "…") pra caber em `largura` pontos na fonte/tamanho atuais. */
function truncar(doc, texto, largura) {
  const t = String(texto ?? '—')
  if (doc.widthOfString(t) <= largura) return t
  let c = t
  while (c.length > 1 && doc.widthOfString(c + '…') > largura) c = c.slice(0, -1)
  return c + '…'
}

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
  const margem = doc.page.margins.left
  const largura = doc.page.width - margem - doc.page.margins.right
  const alturaUtil = doc.page.height - doc.page.margins.bottom - 18
  const alturaLinha = 16
  let y = doc.page.margins.top

  const novaPagina = () => {
    doc.addPage()
    y = doc.page.margins.top
  }
  const garantirEspaco = (altura) => {
    if (y + altura > alturaUtil) {
      novaPagina()
      return true
    }
    return false
  }

  function titulo(texto, tamanho = 15) {
    doc.font('Helvetica-Bold').fontSize(tamanho).fillColor(PRETO).text(texto, margem, y, { width: largura })
    y = doc.y + 4
  }

  /** Faixa preta com o nome da secao + totais ao lado. */
  function faixa(texto, direita) {
    garantirEspaco(34)
    doc.rect(margem, y, largura, 22).fill(PRETO)
    doc.fillColor(AMARELO).font('Helvetica-Bold').fontSize(11).text(texto, margem + 8, y + 6, { width: largura * 0.5, lineBreak: false })
    if (direita) doc.fillColor('#ffffff').font('Helvetica').fontSize(8.5).text(direita, margem + largura * 0.45, y + 7, { width: largura * 0.55 - 8, align: 'right', lineBreak: false })
    y += 28
  }

  function cabecalhoTabela(colunas) {
    doc.rect(margem, y, largura, 16).fill(AMARELO)
    let x = margem
    doc.fillColor(PRETO).font('Helvetica-Bold').fontSize(7.5)
    for (const c of colunas) {
      doc.text(c.titulo, x + 3, y + 4.5, { width: c.largura - 6, align: c.alinhar ?? 'left', lineBreak: false })
      x += c.largura
    }
    y += 18
  }

  /** Desenha as linhas da tabela, repetindo o cabecalho quando quebra de pagina. */
  function tabela(colunas, linhas, { zebra = true, negritoUltima = false } = {}) {
    cabecalhoTabela(colunas)
    linhas.forEach((linha, i) => {
      if (garantirEspaco(alturaLinha)) cabecalhoTabela(colunas)
      const ultima = negritoUltima && i === linhas.length - 1
      if (ultima) doc.rect(margem, y - 1, largura, alturaLinha).fill('#f1f1f1')
      else if (zebra && i % 2 === 1) doc.rect(margem, y - 1, largura, alturaLinha).fill('#f8f8f8')
      let x = margem
      doc.font(ultima ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
      colunas.forEach((c, k) => {
        const celula = linha[k]
        const { texto, cor } = typeof celula === 'object' && celula !== null ? celula : { texto: celula }
        doc.fillColor(cor ?? PRETO).text(truncar(doc, texto, c.largura - 6), x + 3, y + 3, { width: c.largura - 6, align: c.alinhar ?? 'left', lineBreak: false })
        x += c.largura
      })
      doc.moveTo(margem, y + alturaLinha - 1).lineTo(margem + largura, y + alturaLinha - 1).strokeColor(LINHA).lineWidth(0.4).stroke()
      y += alturaLinha
    })
    y += 8
  }

  // --- Capa / resumo --------------------------------------------------------------------
  doc.rect(0, 0, doc.page.width, 64).fill(PRETO)
  doc.fillColor(AMARELO).font('Helvetica-Bold').fontSize(22).text('GFERRO', margem, 20)
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15).text('Relatório de Entregas', margem, 16, { width: largura, align: 'right' })
  doc.fillColor(AMARELO).font('Helvetica').fontSize(10).text(periodoRotulo, margem, 36, { width: largura, align: 'right' })
  doc.fillColor('#ffffff').fontSize(8).text(`Gerado em ${geradoEm}`, margem, 49, { width: largura, align: 'right' })
  y = 80

  const t = agrupado.total
  const cartoes = [
    ['Entregas', String(t.entregas)],
    ['Pedidos', String(t.pedidos)],
    ['Metragem', `${numero(t.metragem)} m²`],
    ['Valor dos pedidos', moeda(t.valorPedidos)],
    ['Recebido na entrega', moeda(t.recebidoNaEntrega)],
    ['Em aberto', moeda(t.emAberto)],
  ]
  const larg = (largura - 5 * 8) / 6
  cartoes.forEach(([rotulo, valor], i) => {
    const x = margem + i * (larg + 8)
    doc.roundedRect(x, y, larg, 44, 4).strokeColor(LINHA).lineWidth(0.8).stroke()
    doc.fillColor(CINZA).font('Helvetica').fontSize(7.5).text(rotulo.toUpperCase(), x + 8, y + 7, { width: larg - 16, lineBreak: false })
    doc.fillColor(PRETO).font('Helvetica-Bold').fontSize(12).text(valor, x + 8, y + 22, { width: larg - 16, lineBreak: false })
  })
  y += 56

  if (semTabelaDeLojas) {
    doc.fillColor(VERMELHO).font('Helvetica-Bold').fontSize(9).text('Atenção: a tabela de vendedores por loja (dados/vendedor-loja.json) não foi encontrada — todos os pedidos aparecem em "Sem loja".', margem, y, { width: largura })
    y = doc.y + 8
  } else if (vendedoresSemLoja.length > 0) {
    doc.fillColor(CINZA).font('Helvetica').fontSize(8).text(`Vendedores sem loja na tabela: ${vendedoresSemLoja.join(', ')}.`, margem, y, { width: largura })
    y = doc.y + 8
  }

  titulo('Resumo por loja', 12)
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
  tabela(colResumoLoja, linhasResumoLoja, { negritoUltima: true })

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
    novaPagina()
    faixa(loja.nome, `${totais.entregas} entrega(s) · ${moeda(totais.valorPedidos)} em pedidos · ${moeda(totais.recebidoNaEntrega)} recebido na entrega`)
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
    tabela(colEntregas, corpo, { negritoUltima: true })
  }

  // --- Resumo por motorista (final) -----------------------------------------------------------
  novaPagina()
  faixa('Resumo por motorista', `${agrupado.porMotorista.length} motorista(s)`)
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
  tabela(colMotorista, corpoMotorista, { negritoUltima: true })
  doc.fillColor(CINZA).font('Helvetica').fontSize(7.5).text(
    '“Recebeu na entrega?”: parcelas do pedido marcadas ENTREGA no Nomus (valor e forma de pagamento) cruzadas com o contas a receber — “Sim” = já baixada, “A receber” = cobrança na entrega ainda sem baixa; pedido sem parcela ENTREGA usa as baixas lançadas no dia da entrega. “Rec. antes” = demais recebimentos (entrada, pago antecipado). “Em aberto” = valor do pedido menos tudo que já foi recebido.',
    margem, y, { width: largura },
  )

  // Rodape com numero de pagina em todas.
  const total = doc.bufferedPageRange().count
  for (let i = 0; i < total; i++) {
    doc.switchToPage(i)
    doc.page.margins.bottom = 0 // o rodape fica dentro da margem inferior: sem isso o PDFKit abre uma pagina nova
    doc.fillColor(CINZA).font('Helvetica').fontSize(7.5).text(`GFERRO · Relatório de Entregas · ${periodoRotulo}  —  página ${i + 1} de ${total}`, margem, doc.page.height - 24, { width: largura, align: 'center', lineBreak: false })
  }
}
