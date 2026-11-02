import test from 'node:test'
import assert from 'node:assert/strict'
import PDFDocument from 'pdfkit'
import {
  dataNomusParaIso,
  codigoNomusDoPedido,
  contaEDoPedido,
  resumirRecebimento,
  parcelaEhDaEntrega,
  numeroDaParcela,
  montarLinha,
  totaisDasLinhas,
  agruparRelatorio,
} from './relatorioEntregas.js'
import { criarTabelaDeLojas, SEM_LOJA } from './lojas.js'
import { gerarPdfEntregasCompleto, textoRecebimento } from './relatorioEntregasPdf.js'

// Tabela FICTICIA (nomes inventados): o dado real fica em dados/vendedor-loja.json, fora do Git.
const tabela = criarTabelaDeLojas({
  lojas: [
    { id: 'a', nome: 'Unidade A' },
    { id: 'b', nome: 'Unidade B' },
  ],
  vendedores: { 'Maria Exemplo da Silva': 'a', 'JOAO TESTE': 'b' },
  vendedoresPorPrimeiroNome: { CARLOS: 'b' },
})

test('lojaDoVendedor ignora acento, caixa e espacos; cai no primeiro nome; senao SEM_LOJA', () => {
  assert.equal(tabela.lojaDoVendedor('maria  exemplo da síLVA').id, 'a')
  assert.equal(tabela.lojaDoVendedor('João Teste').id, 'b')
  assert.equal(tabela.lojaDoVendedor('Carlos Qualquer Sobrenome').id, 'b')
  assert.equal(tabela.lojaDoVendedor('Fulano Desconhecido'), SEM_LOJA)
  assert.equal(tabela.lojaDoVendedor(''), SEM_LOJA)
  assert.equal(tabela.lojaDoVendedor(null), SEM_LOJA)
})

test('tabela vazia (arquivo ausente) manda todo mundo pra SEM_LOJA e avisa que nao tem dados', () => {
  const vazia = criarTabelaDeLojas({})
  assert.equal(vazia.temDados, false)
  assert.equal(vazia.lojaDoVendedor('Qualquer Um'), SEM_LOJA)
})

test('dataNomusParaIso e codigoNomusDoPedido', () => {
  assert.equal(dataNomusParaIso('16/10/2026'), '2026-10-16')
  assert.equal(dataNomusParaIso('16/10/2026 10:25:57'), '2026-10-16')
  assert.equal(dataNomusParaIso('lixo'), null)
  assert.equal(codigoNomusDoPedido('2158'), 'PD 02158')
  assert.equal(codigoNomusDoPedido('PD 02158'), 'PD 02158')
  assert.equal(codigoNomusDoPedido(''), null)
})

test('contaEDoPedido nao confunde PD 2158 com PD 21580', () => {
  assert.equal(contaEDoPedido({ descricaoLancamento: 'Pedido PD 02158 - Parcela 2 de 2' }, '2158'), true)
  assert.equal(contaEDoPedido({ descricaoLancamento: 'Pedido PD 21580 - Parcela 1 de 1' }, '2158'), false)
  assert.equal(contaEDoPedido({ descricaoLancamento: 'Outra coisa' }, '2158'), false)
})

const conta = (valor, dataBaixa, forma = 'Pix', descricao = 'Pedido PD 02158 - Parcela 1 de 1') => ({
  status: true,
  valorRecebido: valor,
  dataBaixa,
  nomeFormaPagamento: forma,
  descricaoLancamento: descricao,
})
const formas = { 13: 'Pix', 1: 'Dinheiro', 3: 'Cartão de Crédito' }
const nomeDaForma = (id) => formas[id] ?? null

test('parcelaEhDaEntrega e numeroDaParcela', () => {
  assert.equal(parcelaEhDaEntrega({ observacao: 'ENTREGA' }), true)
  assert.equal(parcelaEhDaEntrega({ observacao: 'pagar na entrega' }), true)
  assert.equal(parcelaEhDaEntrega({ observacao: 'ENTREGA PIX' }), true)
  assert.equal(parcelaEhDaEntrega({ observacao: 'ENTRADA' }), false)
  assert.equal(parcelaEhDaEntrega({ observacao: '100% PAGO' }), false)
  assert.equal(parcelaEhDaEntrega({ observacao: 'retira' }), false)
  assert.equal(parcelaEhDaEntrega({}), false)
  assert.equal(numeroDaParcela({ descricaoLancamento: 'Pedido PD 02158 - Parcela 2 de 3' }), 2)
  assert.equal(numeroDaParcela({ descricaoLancamento: 'sem parcela' }), null)
})

test('resumirRecebimento: parcela ENTREGA ja baixada = "Sim" com valor e forma; entrada conta como antes', () => {
  const parcelas = [
    { observacao: 'ENTRADA', valor: 1000, idFormaPagamento: 13 },
    { observacao: 'ENTREGA', valor: 500, idFormaPagamento: 1 },
  ]
  const contas = [
    conta('1.000,00', '15/10/2026', 'Pix', 'Pedido PD 1 - Parcela 1 de 2'),
    conta('500,00', '30/10/2026', 'Dinheiro', 'Pedido PD 1 - Parcela 2 de 2'), // baixa NAO e no dia da entrega: vale a parcela
  ]
  const r = resumirRecebimento(contas, '2026-10-29', 1500, parcelas, nomeDaForma)
  assert.equal(r.situacao, 'RECEBIDO')
  assert.equal(r.cobranca, 500)
  assert.equal(r.naEntrega, 500)
  assert.equal(r.antes, 1000)
  assert.equal(r.emAberto, 0)
  assert.deepEqual(r.formas, ['Dinheiro'])
  assert.equal(r.criterio, 'parcela')
})

test('resumirRecebimento: parcela ENTREGA sem baixa = "A receber"; baixa menor = "Parcial"', () => {
  const parcelas = [{ observacao: 'ENTREGA', valor: 800, idFormaPagamento: 13 }]
  const aReceber = resumirRecebimento([], '2026-10-29', 800, parcelas, nomeDaForma)
  assert.equal(aReceber.situacao, 'A_RECEBER')
  assert.equal(aReceber.cobranca, 800)
  assert.equal(aReceber.emAberto, 800)
  const parcial = resumirRecebimento([conta('300,00', '29/10/2026', 'Pix', 'Pedido PD 1 - Parcela 1 de 1')], '2026-10-29', 800, parcelas, nomeDaForma)
  assert.equal(parcial.situacao, 'PARCIAL')
  assert.equal(parcial.naEntrega, 300)
  assert.equal(parcial.emAberto, 500)
})

test('resumirRecebimento: tudo pago antes (100% PAGO) = "pago antes", sem cobranca na entrega', () => {
  const parcelas = [{ observacao: '100% PAGO', valor: 1354, idFormaPagamento: 3 }]
  const r = resumirRecebimento([conta('1.354,00', '16/10/2026', 'Cartão de Crédito', 'Pedido PD 1 - Parcela 1 de 1')], '2026-10-15', 1354, parcelas, nomeDaForma)
  assert.equal(r.situacao, 'PAGO_ANTES')
  assert.equal(r.cobranca, 0)
  assert.equal(r.antes, 1354)
})

test('resumirRecebimento: sem parcela marcada ENTREGA cai no criterio do dia da baixa', () => {
  const r = resumirRecebimento([conta('400,00', '29/10/2026', 'Dinheiro'), conta('100,00', '10/10/2026')], '2026-10-29', 1000, [{ observacao: 'ENTRADA', valor: 100, idFormaPagamento: 13 }], nomeDaForma)
  assert.equal(r.criterio, 'dia')
  assert.equal(r.situacao, 'RECEBIDO')
  assert.equal(r.naEntrega, 400)
  assert.equal(r.antes, 100)
  assert.deepEqual(r.formas, ['Dinheiro'])
})

test('resumirRecebimento ignora conta nao baixada/sem valor e nunca deixa "em aberto" negativo', () => {
  const r = resumirRecebimento([{ status: false, valorRecebido: '999,00', dataBaixa: '29/10/2026' }, { valorRecebido: '0,00', dataBaixa: '29/10/2026' }, conta('1.200,00', '29/10/2026')], '2026-10-29', 1000, [])
  assert.equal(r.total, 1200)
  assert.equal(r.emAberto, 0)
})

test('resumirRecebimento sem valor do pedido nao inventa "em aberto"', () => {
  assert.equal(resumirRecebimento([conta('100,00', '29/10/2026')], '2026-10-29', null).emAberto, null)
})

function entrega(extra) {
  return { id: Math.random(), data: '2026-10-29', pedido: '2158', cliente: 'Cliente Teste', metragem: 10, valor: 500, ...extra }
}
const nomes = { nomeMotorista: 'Motorista Um', placaCaminhao: 'AAA-0001' }

test('montarLinha liga vendedor -> loja e calcula o recebimento; pedido nao encontrado cai em SEM_LOJA', () => {
  const ok = montarLinha(
    entrega(),
    nomes,
    { encontrado: true, valorTotal: 1000, vendedor: 'JOAO TESTE', parcelas: [{ observacao: 'ENTREGA', valor: 400, idFormaPagamento: 13 }] },
    [conta('400,00', '29/10/2026')],
    tabela,
    nomeDaForma,
  )
  assert.equal(ok.loja.id, 'b')
  assert.equal(ok.valorPedido, 1000)
  assert.equal(ok.recebimento.naEntrega, 400)
  const semPedido = montarLinha(entrega({ pedido: '999' }), nomes, { encontrado: false }, [], tabela)
  assert.equal(semPedido.loja, SEM_LOJA)
  assert.equal(semPedido.valorPedido, 500) // cai no valor digitado na entrega
  assert.equal(semPedido.pedidoEncontrado, false)
})

test('agruparRelatorio: lojas na ordem da tabela (sem loja por ultimo), motoristas em ordem alfabetica e totais', () => {
  const linhas = [
    montarLinha(entrega({ pedido: '1' }), { nomeMotorista: 'Zeca', placaCaminhao: 'X' }, { encontrado: true, valorTotal: 100, vendedor: 'JOAO TESTE', parcelas: [{ observacao: 'ENTREGA', valor: 100, idFormaPagamento: 13 }] }, [conta('100,00', '29/10/2026')], tabela),
    montarLinha(entrega({ pedido: '2' }), { nomeMotorista: 'Ana', placaCaminhao: 'Y' }, { encontrado: true, valorTotal: 200, vendedor: 'Maria Exemplo da Silva' }, [], tabela),
    montarLinha(entrega({ pedido: '3' }), { nomeMotorista: 'Ana', placaCaminhao: 'Y' }, { encontrado: false }, [], tabela),
  ]
  const g = agruparRelatorio(linhas, tabela)
  assert.deepEqual(g.porLoja.map((x) => x.loja.id), ['a', 'b', 'sem-loja'])
  assert.deepEqual(g.porMotorista.map((x) => x.motorista), ['Ana', 'Zeca'])
  assert.equal(g.porMotorista[0].totais.entregas, 2)
  assert.equal(g.total.entregas, 3)
  assert.equal(g.total.recebidoNaEntrega, 100)
  assert.equal(g.total.comRecebimentoNaEntrega, 1)
  assert.equal(totaisDasLinhas([]).entregas, 0)
})

test('textoRecebimento descreve cada situacao', () => {
  const base = { formas: [], naEntrega: 0, cobranca: 0 }
  assert.equal(textoRecebimento({ ...base, situacao: 'NAO' }), 'Não')
  assert.match(textoRecebimento({ ...base, situacao: 'RECEBIDO', naEntrega: 500, cobranca: 500, formas: ['Pix'] }), /^Sim — R\$ 500,00 \(Pix\)$/)
  assert.match(textoRecebimento({ ...base, situacao: 'PARCIAL', naEntrega: 200, cobranca: 500 }), /^Parcial — R\$ 200,00 de R\$ 500,00$/)
  assert.match(textoRecebimento({ ...base, situacao: 'A_RECEBER', cobranca: 500, formas: ['Dinheiro'] }), /^A receber — R\$ 500,00 \(Dinheiro\)$/)
  assert.equal(textoRecebimento({ ...base, situacao: 'PAGO_ANTES' }), 'Não — pago antes')
})

test('o PDF renderiza (varias paginas, cabecalho %PDF) com dado ficticio', async () => {
  const linhas = []
  for (let i = 1; i <= 60; i++) {
    linhas.push(
      montarLinha(
        entrega({ pedido: String(1000 + i), data: `2026-10-${String((i % 28) + 1).padStart(2, '0')}` }),
        { nomeMotorista: i % 2 ? 'Motorista Um' : 'Motorista Dois', placaCaminhao: 'AAA-0001' },
        { encontrado: true, valorTotal: 1000 + i, vendedor: i % 3 ? 'JOAO TESTE' : 'Maria Exemplo da Silva' },
        i % 4 === 0 ? [conta('300,00', `${String((i % 28) + 1).padStart(2, '0')}/10/2026`)] : [],
        tabela,
      ),
    )
  }
  const agrupado = agruparRelatorio(linhas, tabela)
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape', bufferPages: true })
  const partes = []
  doc.on('data', (p) => partes.push(p))
  const fim = new Promise((r) => doc.on('end', r))
  gerarPdfEntregasCompleto(doc, { periodoRotulo: 'outubro de 2026', geradoEm: '01/11/2026 10:00', agrupado })
  const paginas = doc.bufferedPageRange().count
  doc.end()
  await fim
  const buffer = Buffer.concat(partes)
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF')
  assert.ok(buffer.length > 5000)
  assert.ok(paginas >= 3, `esperava >= 3 paginas, saiu ${paginas}`)
})

test('totaisDasLinhas: pedido entregue em duas viagens soma a metragem das duas, mas o valor so uma vez', () => {
  const info = { encontrado: true, valorTotal: 1000, vendedor: 'JOAO TESTE', parcelas: [{ observacao: 'ENTREGA', valor: 400, idFormaPagamento: 13 }] }
  const contas = [conta('400,00', '29/10/2026', 'Pix', 'Pedido PD 1 - Parcela 1 de 1')]
  const viagem1 = montarLinha(entrega({ pedido: '1', metragem: 10 }), nomes, info, contas, tabela, nomeDaForma)
  const viagem2 = montarLinha(entrega({ pedido: 'PD 00001', metragem: 5 }), nomes, info, contas, tabela, nomeDaForma)
  const t = totaisDasLinhas([viagem1, viagem2])
  assert.equal(t.entregas, 2)
  assert.equal(t.pedidos, 1)
  assert.equal(t.metragem, 15)
  assert.equal(t.valorPedidos, 1000)
  assert.equal(t.recebidoNaEntrega, 400)
})
