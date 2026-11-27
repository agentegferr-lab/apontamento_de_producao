import test from 'node:test'
import assert from 'node:assert/strict'
import { periodoPronto, previaEps, formatarRendimento, csvDosLancamentos, dataBr } from './epsCampos.js'

const trapezio = { id: 'TRAPEZIO_TR25', placasPorBloco: 40 }

test('periodoPronto: hoje, ultimos 7 dias e mes corrente', () => {
  const hoje = new Date(2026, 10, 17) // 17/11/2026
  assert.deepEqual(periodoPronto('hoje', hoje), { inicio: '2026-11-17', fim: '2026-11-17' })
  assert.deepEqual(periodoPronto('semana', hoje), { inicio: '2026-11-11', fim: '2026-11-17' })
  assert.deepEqual(periodoPronto('mes', hoje), { inicio: '2026-11-01', fim: '2026-11-17' })
})

test('previaEps: esperado, diferenca e rendimento ao digitar', () => {
  assert.equal(previaEps(null, 5, 10), null)
  assert.equal(previaEps(trapezio, '', ''), null)
  assert.deepEqual(previaEps(trapezio, '5', ''), { esperado: 200, diferenca: null, rendimento: null })
  assert.deepEqual(previaEps(trapezio, '5', '190'), { esperado: 200, diferenca: -10, rendimento: 0.95 })
})

test('formatacao de rendimento e data', () => {
  assert.equal(formatarRendimento(null), '—')
  assert.match(formatarRendimento(0.955), /^95,5\s?%$/)
  assert.equal(dataBr('2026-11-03'), '03/11/2026')
})

test('csv: BOM, ponto e virgula, aspas escapadas', () => {
  const csv = csvDosLancamentos([
    { data: '2026-11-03', colaborador: { nome: 'Ana "A"', matricula: '12' }, tipoRotulo: 'Trapézio TR25', blocos: 5, placas: 190, esperado: 200, diferenca: -10, rendimento: 0.95, metros: 190, valor: 1083, observacao: null },
  ])
  assert.ok(csv.startsWith('﻿"Data";'))
  const linha = csv.split('\r\n')[1]
  assert.equal(linha, '"03/11/2026";"Ana ""A""";"12";"Trapézio TR25";"5";"190";"200";"-10";"95,0%";"190";"1083,00";""')
})
