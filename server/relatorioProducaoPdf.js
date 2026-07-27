/**
 * Desenha o conteudo do Relatorio de Producao num PDFDocument ja criado (ver
 * server/index.js, GET /api/relatorio-producao/pdf) — separado da geracao do documento em si
 * pra poder testar sem precisar gravar um arquivo de verdade (um PDFDocument em modo teste
 * ainda escreve bytes reais, so nao mandamos pra disco/resposta).
 *
 * Nao compartilha formatacao com o cliente (client/src/producaoCampos.js) — mesma convencao
 * do resto do projeto, client e server nunca importam um do outro.
 */

function formatarNumeroBr(n) {
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function formatarUnidade(unidade) {
  if (!unidade) return ''
  return unidade.charAt(0) + unidade.slice(1).toLowerCase()
}

function formatarDuracao(ms) {
  const totalMin = Math.round((ms ?? 0) / 60_000)
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (h === 0) return `${min}min`
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

/** Corta o texto (com "…" no fim) pra caber em `largura` pontos, na fonte/tamanho atuais do doc. */
function truncar(doc, texto, largura) {
  const t = String(texto ?? '')
  if (doc.widthOfString(t) <= largura) return t
  let cortado = t
  while (cortado.length > 1 && doc.widthOfString(cortado + '…') > largura) {
    cortado = cortado.slice(0, -1)
  }
  return cortado + '…'
}

const COLUNAS = [
  { chave: 'dataHora', titulo: 'Data/Hora', largura: 85 },
  { chave: 'centro', titulo: 'Centro', largura: 60 },
  { chave: 'os', titulo: 'OS', largura: 65 },
  { chave: 'etapa', titulo: 'Etapa', largura: 90 },
  { chave: 'producao', titulo: 'Produção', largura: 65 },
  { chave: 'colaborador', titulo: 'Colaborador', largura: 90 },
  { chave: 'duracao', titulo: 'Duração', largura: 40 },
]

function linhaDetalhado(d) {
  return {
    dataHora: d.dataHoraFinal ?? '—',
    centro: d.centro,
    os: d.nomeOrdem ?? '—',
    etapa: d.descricaoEtapa ?? '—',
    producao: d.quantidade != null ? `${formatarNumeroBr(d.quantidade)} ${formatarUnidade(d.unidadeMedida)}` : '—',
    colaborador: d.funcionario ?? '—',
    duracao: formatarDuracao(d.duracaoMs),
  }
}

/**
 * @param doc PDFDocument ja criado (margin definido por quem chama).
 * @param porCentro / detalhado — mesmo formato devolvido por montarRelatorioProducao().
 */
export function gerarPdfRelatorioProducao(doc, { periodoRotulo, porCentro, detalhado, geradoEm }) {
  const margemX = doc.page.margins.left
  const margemSuperior = doc.page.margins.top
  const margemInferior = doc.page.margins.bottom
  const larguraUtil = doc.page.width - margemX - doc.page.margins.right

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text('Relatório de Produção', margemX, margemSuperior)
  doc.fontSize(11).font('Helvetica').fillColor('#555').text(`Período: ${periodoRotulo}`, margemX, doc.y + 4)
  doc.fontSize(9).fillColor('#888').text(`Gerado em ${geradoEm}`, margemX, doc.y + 2)

  let y = doc.y + 16
  doc.fillColor('#000')

  doc.fontSize(13).font('Helvetica-Bold').text('Resumo por centro de trabalho', margemX, y)
  y = doc.y + 8

  doc.fontSize(9)
  if (porCentro.length === 0) {
    doc.font('Helvetica').fillColor('#888').text('Nenhum apontamento registrado neste período.', margemX, y)
    y = doc.y
  }
  for (const c of porCentro) {
    const producaoTexto = c.quantidades.length
      ? c.quantidades.map((q) => `${formatarNumeroBr(q.total)} ${formatarUnidade(q.unidade)}`).join(', ')
      : 'sem produção registrada'
    doc.fillColor('#000').font('Helvetica-Bold').text(c.centro, margemX, y, { continued: true })
    doc
      .font('Helvetica')
      .text(`  ${producaoTexto} · ${c.ordens} ${c.ordens === 1 ? 'ordem' : 'ordens'} · ${formatarDuracao(c.tempoMs)}`)
    y = doc.y + 4
  }

  y += 12
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#000').text('Apontamentos detalhados', margemX, y)
  y = doc.y + 10

  const alturaLinha = 16

  function desenharCabecalho() {
    let x = margemX
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555')
    for (const col of COLUNAS) {
      doc.text(col.titulo, x, y, { width: col.largura, lineBreak: false })
      x += col.largura
    }
    y += 12
    doc.moveTo(margemX, y).lineTo(margemX + larguraUtil, y).strokeColor('#ccc').lineWidth(0.5).stroke()
    y += 4
    doc.fillColor('#000').font('Helvetica').fontSize(8)
  }

  desenharCabecalho()

  if (detalhado.length === 0) {
    doc.fontSize(9).fillColor('#888').text('Nenhum apontamento neste período.', margemX, y)
    return
  }

  for (const d of detalhado) {
    if (y + alturaLinha > doc.page.height - margemInferior) {
      doc.addPage()
      y = margemSuperior
      desenharCabecalho()
    }
    const linha = linhaDetalhado(d)
    let x = margemX
    for (const col of COLUNAS) {
      const texto = truncar(doc, String(linha[col.chave] ?? ''), col.largura - 4)
      doc.text(texto, x, y, { width: col.largura, lineBreak: false })
      x += col.largura
    }
    y += alturaLinha
  }
}
