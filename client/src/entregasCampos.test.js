import test from 'node:test'
import assert from 'node:assert/strict'
import {
  intervaloDoPeriodo,
  navegarPeriodo,
  filtrarPorPeriodo,
  rankingPorMotorista,
  somarTotais,
  motoristasAtivos,
  pluralizar,
  textoRegistros,
  formatarMetragem,
  filtrarPorBusca,
  filtrarPorSelecao,
  paginar,
  gerarCsvEntregas,
} from './entregasCampos.js'

// 2026-07-25 e sabado — bom caso de teste pra semana (nao cai no domingo/inicio de semana).
const REFERENCIA = new Date(2026, 6, 25)

test('intervaloDoPeriodo "dia": inicio e fim iguais, so a data', () => {
  const { inicio, fim } = intervaloDoPeriodo('dia', REFERENCIA)
  assert.equal(inicio, '2026-07-25')
  assert.equal(fim, '2026-07-25')
})

test('intervaloDoPeriodo "semana": domingo a sabado da semana que contem a referencia', () => {
  const { inicio, fim } = intervaloDoPeriodo('semana', REFERENCIA)
  assert.equal(inicio, '2026-07-19') // domingo
  assert.equal(fim, '2026-07-25') // sabado (a propria referencia, ja que ela e sabado)
})

test('intervaloDoPeriodo "semana": rotulo por extenso, omite o ano na 1a data quando o mesmo ano', () => {
  const { rotulo } = intervaloDoPeriodo('semana', REFERENCIA)
  assert.equal(rotulo, '19 de julho a 25 de julho de 2026')
})

test('intervaloDoPeriodo "semana": rotulo mostra o ano nas duas datas quando cruza o ano', () => {
  // 1/jan/2026 e quinta — semana vai de 28/dez/2025 (domingo) a 3/jan/2026 (sabado).
  const { rotulo } = intervaloDoPeriodo('semana', new Date(2026, 0, 1))
  assert.equal(rotulo, '28 de dezembro de 2025 a 3 de janeiro de 2026')
})

test('intervaloDoPeriodo "mes": do dia 1 ao ultimo dia do mes', () => {
  const { inicio, fim } = intervaloDoPeriodo('mes', REFERENCIA)
  assert.equal(inicio, '2026-07-01')
  assert.equal(fim, '2026-07-31')
})

test('intervaloDoPeriodo "mes": fevereiro respeita o ultimo dia certo (nao fixo em 30)', () => {
  const { fim } = intervaloDoPeriodo('mes', new Date(2026, 1, 10))
  assert.equal(fim, '2026-02-28') // 2026 nao e bissexto
})

test('navegarPeriodo anda 1 dia/semana/mes por vez, pra frente e pra tras', () => {
  assert.equal(navegarPeriodo('dia', REFERENCIA, 1).getDate(), 26)
  assert.equal(navegarPeriodo('dia', REFERENCIA, -1).getDate(), 24)
  assert.equal(navegarPeriodo('semana', REFERENCIA, 1).getDate(), 1) // 25+7 = 1 de agosto
  assert.equal(navegarPeriodo('mes', REFERENCIA, 1).getMonth(), 7) // agosto (0-indexado)
})

test('filtrarPorPeriodo mantem so entregas com data dentro do intervalo, inclusive nas pontas', () => {
  const entregas = [
    { data: '2026-07-18' }, // fora (antes)
    { data: '2026-07-19' }, // dentro (borda)
    { data: '2026-07-22' }, // dentro
    { data: '2026-07-25' }, // dentro (borda)
    { data: '2026-07-26' }, // fora (depois)
  ]
  const filtradas = filtrarPorPeriodo(entregas, { inicio: '2026-07-19', fim: '2026-07-25' })
  assert.deepEqual(filtradas.map((e) => e.data), ['2026-07-19', '2026-07-22', '2026-07-25'])
})

test('rankingPorMotorista soma pedidos/metragem/valor por motorista, do que mais entregou pro que menos', () => {
  const motoristas = [
    { id: 'a', nome: 'Joao', ativo: true },
    { id: 'b', nome: 'Maria', ativo: true },
  ]
  const entregas = [
    { motoristaId: 'a', metragem: 10, valor: 500 },
    { motoristaId: 'b', metragem: 20, valor: 1000 },
    { motoristaId: 'a', metragem: 5, valor: 300 },
    { motoristaId: 'a', metragem: null, valor: null },
  ]
  assert.deepEqual(rankingPorMotorista(entregas, motoristas), [
    { motoristaId: 'a', nome: 'Joao', ativo: true, pedidos: 3, metragem: 15, valor: 800 },
    { motoristaId: 'b', nome: 'Maria', ativo: true, pedidos: 1, metragem: 20, valor: 1000 },
  ])
})

test('rankingPorMotorista: empate em pedidos desfeito por valor total', () => {
  const motoristas = [{ id: 'a', nome: 'Joao', ativo: true }, { id: 'b', nome: 'Maria', ativo: true }]
  const entregas = [
    { motoristaId: 'a', metragem: null, valor: 100 },
    { motoristaId: 'b', metragem: null, valor: 200 },
  ]
  assert.deepEqual(rankingPorMotorista(entregas, motoristas).map((r) => r.motoristaId), ['b', 'a'])
})

test('rankingPorMotorista: motorista que nao existe mais no cadastro ainda aparece, com ativo=false', () => {
  const resultado = rankingPorMotorista([{ motoristaId: 'removido', metragem: null, valor: null }], [])
  assert.deepEqual(resultado, [
    { motoristaId: 'removido', nome: 'Motorista removido', ativo: false, pedidos: 1, metragem: 0, valor: 0 },
  ])
})

test('rankingPorMotorista: motorista sem nenhuma entrega no periodo nao aparece no ranking', () => {
  const motoristas = [{ id: 'a', nome: 'Joao', ativo: true }, { id: 'b', nome: 'Sem entregas', ativo: true }]
  const resultado = rankingPorMotorista([{ motoristaId: 'a', metragem: 1, valor: 1 }], motoristas)
  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].motoristaId, 'a')
})

test('somarTotais soma metragem/valor, ignorando o que o motorista nao informou', () => {
  const entregas = [
    { metragem: 10, valor: 500 },
    { metragem: null, valor: 200 },
    { metragem: 5.5, valor: null },
    { metragem: null, valor: null },
  ]
  assert.deepEqual(somarTotais(entregas), { metragem: 15.5, valor: 700 })
})

test('somarTotais com lista vazia devolve zero, nao NaN', () => {
  assert.deepEqual(somarTotais([]), { metragem: 0, valor: 0 })
})

test('motoristasAtivos filtra so os com ativo=true', () => {
  const motoristas = [{ id: 'a', ativo: true }, { id: 'b', ativo: false }, { id: 'c', ativo: true }]
  assert.deepEqual(motoristasAtivos(motoristas).map((m) => m.id), ['a', 'c'])
})

test('pluralizar: 1 usa singular, 0 e N usam plural', () => {
  assert.equal(pluralizar(1, 'pedido', 'pedidos'), 'pedido')
  assert.equal(pluralizar(0, 'pedido', 'pedidos'), 'pedidos')
  assert.equal(pluralizar(5, 'pedido', 'pedidos'), 'pedidos')
})

test('textoRegistros: zero, singular e plural', () => {
  assert.equal(textoRegistros(0), 'Nenhum registro encontrado')
  assert.equal(textoRegistros(1), '1 registro encontrado')
  assert.equal(textoRegistros(8), '8 registros encontrados')
})

test('formatarMetragem formata em pt-BR com sufixo m²', () => {
  assert.equal(formatarMetragem(247.2), '247,2 m²')
})

test('filtrarPorBusca casa por cliente ou por pedido, case-insensitive; termo vazio devolve tudo', () => {
  const entregas = [
    { pedido: 'PD 00922', cliente: 'Wellington Gomes' },
    { pedido: 'PD 01154', cliente: 'Fulano de Tal' },
    { pedido: 'PD 00100', cliente: null },
  ]
  assert.deepEqual(filtrarPorBusca(entregas, 'wellington').map((e) => e.pedido), ['PD 00922'])
  assert.deepEqual(filtrarPorBusca(entregas, '01154').map((e) => e.pedido), ['PD 01154'])
  assert.equal(filtrarPorBusca(entregas, '').length, 3)
  assert.equal(filtrarPorBusca(entregas, '   ').length, 3)
})

test('filtrarPorSelecao: motoristaId/caminhaoId vazios nao restringem', () => {
  const entregas = [
    { motoristaId: 'a', caminhaoId: 'x' },
    { motoristaId: 'a', caminhaoId: 'y' },
    { motoristaId: 'b', caminhaoId: 'x' },
  ]
  assert.equal(filtrarPorSelecao(entregas, {}).length, 3)
  assert.equal(filtrarPorSelecao(entregas, { motoristaId: 'a' }).length, 2)
  assert.equal(filtrarPorSelecao(entregas, { motoristaId: 'a', caminhaoId: 'x' }).length, 1)
})

test('paginar fatia a lista e ajusta pagina fora do intervalo pro limite valido', () => {
  const itens = Array.from({ length: 25 }, (_, i) => i)
  const p1 = paginar(itens, 1, 10)
  assert.deepEqual(p1, { pagina: 1, totalPaginas: 3, total: 25, itens: itens.slice(0, 10) })
  const p3 = paginar(itens, 3, 10)
  assert.deepEqual(p3.itens, itens.slice(20, 25))
  const alemDoFim = paginar(itens, 99, 10)
  assert.equal(alemDoFim.pagina, 3)
  const vazia = paginar([], 1, 10)
  assert.deepEqual(vazia, { pagina: 1, totalPaginas: 1, total: 0, itens: [] })
})

test('gerarCsvEntregas: BOM + separador ";" + cabecalho + linhas formatadas em pt-BR', () => {
  const nomeMotorista = new Map([['m1', 'João']])
  const placaCaminhao = new Map([['c1', 'ABC-1234']])
  const linhas = [
    { data: '2026-07-27', motoristaId: 'm1', caminhaoId: 'c1', pedido: 'PD 00922', cliente: 'Wellington', metragem: 69, valor: 9500 },
  ]
  const csv = gerarCsvEntregas(linhas, { nomeMotorista, placaCaminhao })
  assert.ok(csv.startsWith('﻿'))
  const linhasCsv = csv.slice(1).split('\r\n')
  assert.equal(linhasCsv[0], 'Data;Motorista;Caminhão;Pedido;Cliente;Metragem (m²);Valor;Status')
  assert.equal(linhasCsv[1], '27/07/2026;João;ABC-1234;PD 00922;Wellington;69;R$ 9.500,00;Entregue')
})

test('gerarCsvEntregas: escapa valores com ";" entre aspas', () => {
  const csv = gerarCsvEntregas(
    [{ data: '2026-01-01', motoristaId: 'x', caminhaoId: 'y', pedido: 'PD 1', cliente: 'Cliente; com ponto e vírgula', metragem: null, valor: null }],
    { nomeMotorista: new Map(), placaCaminhao: new Map() },
  )
  assert.ok(csv.includes('"Cliente; com ponto e vírgula"'))
})
