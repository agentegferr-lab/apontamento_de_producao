import test from 'node:test'
import assert from 'node:assert/strict'
import {
  intervaloDoPeriodo,
  navegarPeriodo,
  formatarDuracao,
  gerarCsvRelatorioProducao,
  quantidadePrincipal,
  calcularTendencia,
  chaveDoDiaNomus,
  ultimosDias,
  serieDiariaPorCentro,
  paginar,
  corDoCentro,
} from './producaoCampos.js'

// 2026-07-25 e sabado.
const REFERENCIA = new Date(2026, 6, 25)

test('intervaloDoPeriodo "dia": inicio e fim iguais', () => {
  const { inicio, fim } = intervaloDoPeriodo('dia', REFERENCIA)
  assert.equal(inicio, '2026-07-25')
  assert.equal(fim, '2026-07-25')
})

test('intervaloDoPeriodo "semana": domingo a sabado, rotulo por extenso', () => {
  const { inicio, fim, rotulo } = intervaloDoPeriodo('semana', REFERENCIA)
  assert.equal(inicio, '2026-07-19')
  assert.equal(fim, '2026-07-25')
  assert.equal(rotulo, '19 de julho a 25 de julho de 2026')
})

test('intervaloDoPeriodo "mes": mes calendario inteiro', () => {
  const { inicio, fim, rotulo } = intervaloDoPeriodo('mes', REFERENCIA)
  assert.equal(inicio, '2026-07-01')
  assert.equal(fim, '2026-07-31')
  assert.equal(rotulo, 'julho de 2026')
})

test('navegarPeriodo anda 1 dia/semana/mes por vez', () => {
  assert.equal(navegarPeriodo('dia', REFERENCIA, 1).getDate(), 26)
  assert.equal(navegarPeriodo('semana', REFERENCIA, -1).getDate(), 18)
  assert.equal(navegarPeriodo('mes', REFERENCIA, 1).getMonth(), 7)
})

test('formatarDuracao: minutos, horas exatas e horas com minutos', () => {
  assert.equal(formatarDuracao(45 * 60_000), '45min')
  assert.equal(formatarDuracao(2 * 60 * 60_000), '2h')
  assert.equal(formatarDuracao(90 * 60_000), '1h30')
  assert.equal(formatarDuracao(0), '0min')
})

test('gerarCsvRelatorioProducao: BOM + cabecalho + linha formatada', () => {
  const csv = gerarCsvRelatorioProducao([
    {
      dataHoraFinal: '27/07/2026 17:53:07',
      centro: 'CORTE',
      nomeOrdem: 'OS 01632 - 001',
      descricaoEtapa: 'Corte da telha',
      quantidade: 210,
      unidadeMedida: 'METRO QUADRADO',
      funcionario: 'DIOGO RODRIGO ESPINDOLA FRANCO',
      duracaoMs: 919_000,
    },
  ])
  assert.ok(csv.startsWith('﻿'))
  const linhas = csv.slice(1).split('\r\n')
  assert.equal(linhas[0], 'Data/hora final;Centro de trabalho;OS;Etapa;Quantidade;Unidade;Colaborador;Duração')
  assert.equal(
    linhas[1],
    '27/07/2026 17:53:07;CORTE;OS 01632 - 001;Corte da telha;210;METRO QUADRADO;DIOGO RODRIGO ESPINDOLA FRANCO;15min',
  )
})

test('gerarCsvRelatorioProducao: quantidade null vira campo vazio, nao "null"', () => {
  const csv = gerarCsvRelatorioProducao([
    { dataHoraFinal: '27/07/2026 17:37:48', centro: 'CORTE', nomeOrdem: 'OS 01632 - 001', descricaoEtapa: 'Corte', quantidade: null, unidadeMedida: null, funcionario: null, duracaoMs: 60_000 },
  ])
  const linha = csv.slice(1).split('\r\n')[1]
  assert.equal(linha, '27/07/2026 17:37:48;CORTE;OS 01632 - 001;Corte;;;;1min')
})

test('quantidadePrincipal escolhe a unidade de maior total; lista vazia devolve null', () => {
  assert.deepEqual(
    quantidadePrincipal([{ unidade: 'UNIDADE', total: 5 }, { unidade: 'METRO QUADRADO', total: 300 }]),
    { unidade: 'METRO QUADRADO', total: 300 },
  )
  assert.equal(quantidadePrincipal([]), null)
  assert.equal(quantidadePrincipal(undefined), null)
})

test('calcularTendencia: alta, baixa, estavel, novo e os dois zerados', () => {
  assert.deepEqual(calcularTendencia(110, 100), { percentual: 10, direcao: 'alta' })
  assert.deepEqual(calcularTendencia(90, 100), { percentual: -10, direcao: 'baixa' })
  assert.deepEqual(calcularTendencia(100.2, 100), { percentual: 0, direcao: 'estavel' }) // < 0.5%
  assert.deepEqual(calcularTendencia(50, 0), { percentual: null, direcao: 'novo' })
  assert.deepEqual(calcularTendencia(0, 0), { percentual: 0, direcao: 'estavel' })
})

test('chaveDoDiaNomus converte "DD/MM/AAAA HH:mm:ss" pra "AAAA-MM-DD"', () => {
  assert.equal(chaveDoDiaNomus('27/07/2026 17:53:07'), '2026-07-27')
  assert.equal(chaveDoDiaNomus('01/01/2027 00:00:00'), '2027-01-01')
})

test('ultimosDias devolve N chaves terminando (inclusive) na data dada, em ordem crescente', () => {
  assert.deepEqual(ultimosDias('2026-07-27', 5), [
    '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27',
  ])
})

test('ultimosDias atravessa virada de mes/ano corretamente', () => {
  assert.deepEqual(ultimosDias('2027-01-01', 3), ['2026-12-30', '2026-12-31', '2027-01-01'])
})

test('serieDiariaPorCentro soma so o centro pedido, zera dias sem apontamento, ignora quantidade null', () => {
  const detalhado = [
    { centro: 'CORTE', quantidade: 100, dataHoraFinal: '25/07/2026 10:00:00' },
    { centro: 'CORTE', quantidade: 50, dataHoraFinal: '25/07/2026 15:00:00' },
    { centro: 'PINTURA', quantidade: 999, dataHoraFinal: '25/07/2026 10:00:00' },
    { centro: 'CORTE', quantidade: null, dataHoraFinal: '26/07/2026 10:00:00' },
  ]
  const dias = ['2026-07-24', '2026-07-25', '2026-07-26']
  assert.deepEqual(serieDiariaPorCentro(detalhado, 'CORTE', dias), [0, 150, 0])
})

test('paginar fatia a lista e ajusta pagina fora do intervalo', () => {
  const itens = Array.from({ length: 25 }, (_, i) => i)
  assert.deepEqual(paginar(itens, 1, 10), { pagina: 1, totalPaginas: 3, total: 25, itens: itens.slice(0, 10) })
  assert.equal(paginar(itens, 99, 10).pagina, 3)
})

test('corDoCentro e deterministico e ciclico', () => {
  assert.equal(corDoCentro(0), corDoCentro(8)) // ciclo de 8 cores
  assert.equal(typeof corDoCentro(2), 'string')
})
