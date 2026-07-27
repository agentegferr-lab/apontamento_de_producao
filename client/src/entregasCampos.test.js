import test from 'node:test'
import assert from 'node:assert/strict'
import { intervaloDoPeriodo, navegarPeriodo, filtrarPorPeriodo, agruparPorMotorista, somarTotais } from './entregasCampos.js'

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

test('agruparPorMotorista conta pedidos por motorista, do que mais entregou pro que menos', () => {
  const motoristas = [{ id: 'a', nome: 'Joao' }, { id: 'b', nome: 'Maria' }]
  const entregas = [{ motoristaId: 'a' }, { motoristaId: 'b' }, { motoristaId: 'a' }, { motoristaId: 'a' }]
  assert.deepEqual(agruparPorMotorista(entregas, motoristas), [
    { motoristaId: 'a', nome: 'Joao', total: 3 },
    { motoristaId: 'b', nome: 'Maria', total: 1 },
  ])
})

test('agruparPorMotorista: motorista que nao existe mais no cadastro ainda aparece no relatorio', () => {
  const resultado = agruparPorMotorista([{ motoristaId: 'removido' }], [])
  assert.deepEqual(resultado, [{ motoristaId: 'removido', nome: 'Motorista removido', total: 1 }])
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
