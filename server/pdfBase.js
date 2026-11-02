/**
 * Base de desenho dos relatorios em PDF (A4 paisagem, identidade GFERRO: preto e amarelo).
 * Usada por relatorioEntregasPdf.js e relatorioPrazoPdf.js — formatacao, cores e as pecas
 * comuns (capa, faixa de secao, tabela com cabecalho repetido, rodape com numero de pagina).
 */

export const PRETO = '#1c1a1a'
export const AMARELO = '#FFD60A'
export const CINZA = '#6b6b6b'
export const LINHA = '#d9d9d9'
export const VERDE = '#15803d'
export const VERMELHO = '#b91c1c'

export const moeda = (n) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ')
export const numero = (n) => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
export const dataBr = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

/** Corta o texto (com "…") pra caber em `largura` pontos na fonte/tamanho atuais. */
export function truncar(doc, texto, largura) {
  const t = String(texto ?? '—')
  if (doc.widthOfString(t) <= largura) return t
  let c = t
  while (c.length > 1 && doc.widthOfString(c + '…') > largura) c = c.slice(0, -1)
  return c + '…'
}

export function criarLayout(doc) {
  const margem = doc.page.margins.left
  const largura = doc.page.width - margem - doc.page.margins.right
  const alturaUtil = doc.page.height - doc.page.margins.bottom - 18
  const alturaLinha = 16
  const estado = { y: doc.page.margins.top }

  const novaPagina = () => {
    doc.addPage()
    estado.y = doc.page.margins.top
  }
  const garantirEspaco = (altura) => {
    if (estado.y + altura > alturaUtil) {
      novaPagina()
      return true
    }
    return false
  }

  function titulo(texto, tamanho = 15) {
    doc.font('Helvetica-Bold').fontSize(tamanho).fillColor(PRETO).text(texto, margem, estado.y, { width: largura })
    estado.y = doc.y + 4
  }

  /** Faixa preta no topo com logo, nome do relatorio, periodo e data de geracao. */
  function capa(nomeRelatorio, periodoRotulo, geradoEm) {
    doc.rect(0, 0, doc.page.width, 64).fill(PRETO)
    doc.fillColor(AMARELO).font('Helvetica-Bold').fontSize(22).text('GFERRO', margem, 20)
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15).text(nomeRelatorio, margem, 16, { width: largura, align: 'right' })
    doc.fillColor(AMARELO).font('Helvetica').fontSize(10).text(periodoRotulo, margem, 36, { width: largura, align: 'right' })
    doc.fillColor('#ffffff').fontSize(8).text(`Gerado em ${geradoEm}`, margem, 49, { width: largura, align: 'right' })
    estado.y = 80
  }

  /** Cartoes de indicadores numa linha: [[rotulo, valor], ...]. */
  function cartoes(itens) {
    const n = itens.length
    const larg = (largura - (n - 1) * 8) / n
    itens.forEach(([rotulo, valor], i) => {
      const x = margem + i * (larg + 8)
      doc.roundedRect(x, estado.y, larg, 44, 4).strokeColor(LINHA).lineWidth(0.8).stroke()
      doc.fillColor(CINZA).font('Helvetica').fontSize(7.5).text(rotulo.toUpperCase(), x + 8, estado.y + 7, { width: larg - 16, lineBreak: false })
      doc.fillColor(PRETO).font('Helvetica-Bold').fontSize(12).text(valor, x + 8, estado.y + 22, { width: larg - 16, lineBreak: false })
    })
    estado.y += 56
  }

  /** Faixa preta com o nome da secao + texto a direita. */
  function faixa(texto, direita) {
    garantirEspaco(34)
    doc.rect(margem, estado.y, largura, 22).fill(PRETO)
    doc.fillColor(AMARELO).font('Helvetica-Bold').fontSize(11).text(texto, margem + 8, estado.y + 6, { width: largura * 0.5, lineBreak: false })
    if (direita) {
      doc.fillColor('#ffffff').font('Helvetica').fontSize(8.5).text(direita, margem + largura * 0.45, estado.y + 7, { width: largura * 0.55 - 8, align: 'right', lineBreak: false })
    }
    estado.y += 28
  }

  function cabecalhoTabela(colunas) {
    doc.rect(margem, estado.y, largura, 16).fill(AMARELO)
    let x = margem
    doc.fillColor(PRETO).font('Helvetica-Bold').fontSize(7.5)
    for (const c of colunas) {
      doc.text(c.titulo, x + 3, estado.y + 4.5, { width: c.largura - 6, align: c.alinhar ?? 'left', lineBreak: false })
      x += c.largura
    }
    estado.y += 18
  }

  /** Cada celula e texto ou { texto, cor }. Repete o cabecalho quando quebra de pagina. */
  function tabela(colunas, linhas, { zebra = true, negritoUltima = false } = {}) {
    cabecalhoTabela(colunas)
    linhas.forEach((linha, i) => {
      if (garantirEspaco(alturaLinha)) cabecalhoTabela(colunas)
      const ultima = negritoUltima && i === linhas.length - 1
      if (ultima) doc.rect(margem, estado.y - 1, largura, alturaLinha).fill('#f1f1f1')
      else if (zebra && i % 2 === 1) doc.rect(margem, estado.y - 1, largura, alturaLinha).fill('#f8f8f8')
      let x = margem
      doc.font(ultima ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
      colunas.forEach((c, k) => {
        const celula = linha[k]
        const { texto, cor } = typeof celula === 'object' && celula !== null ? celula : { texto: celula }
        doc.fillColor(cor ?? PRETO).text(truncar(doc, texto, c.largura - 6), x + 3, estado.y + 3, { width: c.largura - 6, align: c.alinhar ?? 'left', lineBreak: false })
        x += c.largura
      })
      doc.moveTo(margem, estado.y + alturaLinha - 1).lineTo(margem + largura, estado.y + alturaLinha - 1).strokeColor(LINHA).lineWidth(0.4).stroke()
      estado.y += alturaLinha
    })
    estado.y += 8
  }

  function nota(texto, cor = CINZA, tamanho = 7.5) {
    garantirEspaco(32)
    doc.fillColor(cor).font('Helvetica').fontSize(tamanho).text(texto, margem, estado.y, { width: largura })
    estado.y = doc.y + 8
  }

  /** Rodape com numero de pagina em todas as paginas (chamar no fim). */
  function rodape(textoEsquerda) {
    const total = doc.bufferedPageRange().count
    for (let i = 0; i < total; i++) {
      doc.switchToPage(i)
      doc.page.margins.bottom = 0 // o rodape fica dentro da margem inferior: sem isso o PDFKit abre pagina nova
      doc.fillColor(CINZA).font('Helvetica').fontSize(7.5).text(`${textoEsquerda}  —  página ${i + 1} de ${total}`, margem, doc.page.height - 24, { width: largura, align: 'center', lineBreak: false })
    }
  }

  return { margem, largura, estado, novaPagina, garantirEspaco, titulo, capa, cartoes, faixa, tabela, nota, rodape }
}
