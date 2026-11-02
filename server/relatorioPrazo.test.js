import test from 'node:test'
import assert from 'node:assert/strict'
import PDFDocument from 'pdfkit'
import {
  dataNomusParaIso,
  dataPrometidaDoPedido,
  diasEntre,
  classificarPrazo,
  consolidarEntregasPorPedido,
  montarLinhaPrazo,
  totaisDoPrazo,
  agruparPrazo,
} from './relatorioPrazo.js'
import { criarTabelaDeLojas } from './lojas.js'
import { gerarPdfPrazo, textoSituacao } from './relatorioPrazoPdf.js'

// Tabela FICTICIA — o dado real fica em dados/vendedor-loja.json, fora do Git.
const tabela = criarTabelaDeLojas({
  lojas: [{ id: 'a', nome: 'Unidade A' }, { id: 'b', nome: 'Unidade B' }],
  vendedores: { 'Maria Exemplo': 'a', 'Joao Teste': 'b' },
})

test('dataNomusParaIso e diasEntre (corridos, atravessando mes e ano)', () => {
  assert.equal(dataNomusParaIso('18/11/2026 00:00:00'), '2026-11-18')
  assert.equal(dataNomusParaIso(''), null)
  assert.equal(diasEntre('2026-09-08', '2026-10-01'), 23)
  assert.equal(diasEntre('2026-12-30', '2027-01-02'), 3)
  assert.equal(diasEntre('2026-10-05', '2026-10-05'), 0)
  assert.equal(diasEntre('2026-10-05', '2026-10-01'), -4)
})

test('dataPrometidaDoPedido: item mais tardio; sem item cai na data padrao; senao null', () => {
  const comItens = { itensPedido: [{ dataEntrega: '10/10/2026 00:00:00' }, { dataEntrega: '20/10/2026 00:00:00' }, {}], dataEntregaPadrao: '01/09/2026' }
  assert.deepEqual(dataPrometidaDoPedido(comItens), { iso: '2026-10-20', origem: 'itens' })
  assert.deepEqual(dataPrometidaDoPedido({ itensPedido: [], dataEntregaPadrao: '01/09/2026' }), { iso: '2026-09-01', origem: 'padrao' })
  assert.deepEqual(dataPrometidaDoPedido({}), { iso: null, origem: null })
})

test('classificarPrazo: atrasado conta dias; no dia ou antes e no prazo; sem data e SEM_PRAZO', () => {
  assert.deepEqual(classificarPrazo('2026-09-08', '2026-10-01'), { situacao: 'ATRASADO', diasAtraso: 23, diasAntecipado: 0 })
  assert.deepEqual(classificarPrazo('2026-10-10', '2026-10-10'), { situacao: 'NO_PRAZO', diasAtraso: 0, diasAntecipado: 0 })
  assert.deepEqual(classificarPrazo('2026-11-24', '2026-10-22'), { situacao: 'NO_PRAZO', diasAtraso: 0, diasAntecipado: 33 })
  assert.equal(classificarPrazo(null, '2026-10-22').situacao, 'SEM_PRAZO')
})

test('consolidarEntregasPorPedido: usa a PRIMEIRA data e conta os lancamentos (mesmo com "PD 01715" x "1715")', () => {
  const r = consolidarEntregasPorPedido([
    { pedido: '1715', data: '2026-10-15', cliente: null, motorista: 'B' },
    { pedido: 'PD 01715', data: '2026-10-13', cliente: 'Cliente X', motorista: 'A' },
    { pedido: '1715', data: '2026-10-15', motorista: 'C' },
    { pedido: '2000', data: '2026-10-20', motorista: 'A' },
  ])
  assert.equal(r.length, 2)
  const p = r.find((x) => x.chave === '1715')
  assert.equal(p.dataReal, '2026-10-13')
  assert.equal(p.lancamentos, 3)
  assert.equal(p.cliente, 'Cliente X')
  assert.equal(p.motorista, 'A')
})

function linha(pedido, vendedor, prazoIso, dataReal, extra = {}) {
  const cons = { chave: pedido, pedido, dataReal, lancamentos: 1, datas: [dataReal], cliente: 'Cli', motorista: 'M', ...extra }
  return montarLinhaPrazo(cons, { encontrado: true, vendedor, prazoIso, prazoOrigem: 'itens' }, tabela)
}

test('totaisDoPrazo: percentuais so sobre quem tem prazo; media e maior atraso so dos atrasados', () => {
  const t = totaisDoPrazo([
    linha('1', 'Maria Exemplo', '2026-10-10', '2026-10-15'), // 5 dias
    linha('2', 'Maria Exemplo', '2026-10-10', '2026-10-20'), // 10 dias
    linha('3', 'Maria Exemplo', '2026-10-10', '2026-10-05'), // no prazo
    linha('4', 'Maria Exemplo', null, '2026-10-05'), // sem prazo
  ])
  assert.equal(t.pedidos, 4)
  assert.equal(t.comPrazo, 3)
  assert.equal(t.semPrazo, 1)
  assert.equal(t.atrasados, 2)
  assert.equal(t.noPrazo, 1)
  assert.equal(t.pctAtrasados, 66.7)
  assert.equal(t.diasAtrasoTotal, 15)
  assert.equal(t.mediaAtraso, 7.5)
  assert.equal(t.maiorAtraso, 10)
})

test('agruparPrazo: lojas na ordem da tabela, atrasados primeiro (mais dias antes), repetidos listados', () => {
  const g = agruparPrazo(
    [
      linha('1', 'Joao Teste', '2026-10-10', '2026-10-09'),
      linha('2', 'Maria Exemplo', '2026-10-10', '2026-10-12'),
      linha('3', 'Maria Exemplo', '2026-10-10', '2026-10-20'),
      linha('4', 'Alguem Sem Loja', '2026-10-10', '2026-10-11'),
      linha('5', 'Maria Exemplo', '2026-10-10', '2026-10-01', { lancamentos: 2, datas: ['2026-10-01', '2026-10-03'] }),
    ],
    tabela,
  )
  assert.deepEqual(g.porLoja.map((x) => x.loja.id), ['a', 'b', 'sem-loja'])
  assert.deepEqual(g.porLoja[0].linhas.map((l) => l.pedido), ['3', '2', '5']) // 10d, 2d, no prazo
  assert.equal(g.total.pedidos, 5)
  assert.deepEqual(g.repetidos, [{ pedido: '5', lancamentos: 2, datas: ['2026-10-01', '2026-10-03'] }])
})

test('textoSituacao descreve cada caso', () => {
  assert.equal(textoSituacao({ situacao: 'ATRASADO', diasAtraso: 1 }).texto, 'Atrasado — 1 dia')
  assert.equal(textoSituacao({ situacao: 'ATRASADO', diasAtraso: 23 }).texto, 'Atrasado — 23 dias')
  assert.equal(textoSituacao({ situacao: 'NO_PRAZO', diasAntecipado: 0 }).texto, 'No prazo — no dia')
  assert.equal(textoSituacao({ situacao: 'NO_PRAZO', diasAntecipado: 5 }).texto, 'No prazo — 5 dias antes')
  assert.equal(textoSituacao({ situacao: 'SEM_PRAZO', pedidoEncontrado: false }).texto, 'Pedido não encontrado')
})

test('o PDF de prazo renderiza com dado ficticio', async () => {
  const linhas = []
  for (let i = 1; i <= 70; i++) {
    linhas.push(linha(String(1000 + i), i % 2 ? 'Maria Exemplo' : 'Joao Teste', '2026-10-10', `2026-10-${String((i % 28) + 1).padStart(2, '0')}`))
  }
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape', bufferPages: true })
  const partes = []
  doc.on('data', (p) => partes.push(p))
  const fim = new Promise((r) => doc.on('end', r))
  gerarPdfPrazo(doc, { periodoRotulo: 'outubro de 2026', geradoEm: '01/11/2026 10:00', agrupado: agruparPrazo(linhas, tabela) })
  const paginas = doc.bufferedPageRange().count
  doc.end()
  await fim
  const buffer = Buffer.concat(partes)
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF')
  assert.ok(paginas >= 3, `esperava >= 3 paginas, saiu ${paginas}`)
})
