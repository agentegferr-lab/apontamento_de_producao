import test from 'node:test'
import assert from 'node:assert/strict'
import { intervaloDoPeriodo, navegarPeriodo, formatarDuracao, gerarCsvRelatorioProducao } from './producaoCampos.js'

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
