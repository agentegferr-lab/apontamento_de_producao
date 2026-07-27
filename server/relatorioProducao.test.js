import test from 'node:test'
import assert from 'node:assert/strict'
import { montarRelatorioProducao } from './relatorioProducao.js'

const OPERACOES = [
  { id: 100, idOrdem: 1, nomeOrdem: 'OS 00001 - 001', operacao: 10, descricao: 'Corte da telha', centroTrabalhoPlanejado: 'CORTE' },
  { id: 101, idOrdem: 1, nomeOrdem: 'OS 00001 - 001', operacao: 20, descricao: 'Pintura', centroTrabalhoPlanejado: 'PINTURA' },
  { id: 102, idOrdem: 2, nomeOrdem: 'OS 00002 - 001', operacao: 10, descricao: 'Corte da telha', centroTrabalhoPlanejado: 'CORTE' },
]

const FUNCIONARIOS = [{ id: 3, nome: 'DIOGO RODRIGO ESPINDOLA FRANCO' }]

test('agrupa quantidade por centro de trabalho e por unidade, so contando apontamentos com quantidade > 0', () => {
  const apontamentos = [
    // segmento intermediario (pausa/retomada) — quantidade 0, nao entra na soma mas conta pro tempo/apontamentos.
    {
      id: 1,
      idOperacaoOrdem: 100,
      idFuncionario: 3,
      dataHoraInicial: '27/07/2026 08:00:00',
      dataHoraFinal: '27/07/2026 09:00:00',
      quantidade: '0.000000',
      unidadeMedida: 'METRO QUADRADO',
    },
    // segmento final — quantidade real.
    {
      id: 2,
      idOperacaoOrdem: 100,
      idFuncionario: 3,
      dataHoraInicial: '27/07/2026 09:00:00',
      dataHoraFinal: '27/07/2026 10:30:00',
      quantidade: '210.000000',
      unidadeMedida: 'METRO QUADRADO',
    },
    // outra ordem, mesmo centro (Corte).
    {
      id: 3,
      idOperacaoOrdem: 102,
      idFuncionario: 3,
      dataHoraInicial: '27/07/2026 11:00:00',
      dataHoraFinal: '27/07/2026 11:45:00',
      quantidade: '80.000000',
      unidadeMedida: 'METRO QUADRADO',
    },
    // Pintura.
    {
      id: 4,
      idOperacaoOrdem: 101,
      idFuncionario: 3,
      dataHoraInicial: '27/07/2026 13:00:00',
      dataHoraFinal: '27/07/2026 14:00:00',
      quantidade: '210.000000',
      unidadeMedida: 'METRO QUADRADO',
    },
  ]

  const r = montarRelatorioProducao({
    operacoes: OPERACOES,
    apontamentos,
    funcionarios: FUNCIONARIOS,
    inicio: '2026-07-27',
    fim: '2026-07-27',
  })

  assert.equal(r.totalApontamentos, 4)
  assert.deepEqual(
    r.porCentro.map((c) => c.centro),
    ['CORTE', 'PINTURA'], // ordem do fluxo fisico (operacao 10 antes de 20), nao alfabetica
  )

  const corte = r.porCentro.find((c) => c.centro === 'CORTE')
  assert.equal(corte.apontamentos, 3) // inclui o segmento de quantidade 0
  assert.equal(corte.ordens, 2) // OS 00001 e OS 00002
  assert.deepEqual(corte.quantidades, [{ unidade: 'METRO QUADRADO', total: 290 }]) // 210 + 80, NAO conta o segmento 0
  assert.equal(corte.tempoMs, (60 + 90 + 45) * 60_000)

  const pintura = r.porCentro.find((c) => c.centro === 'PINTURA')
  assert.deepEqual(pintura.quantidades, [{ unidade: 'METRO QUADRADO', total: 210 }])
})

test('apontamento conta pro dia em que TERMINOU (dataHoraFinal), nao em que comecou', () => {
  const apontamentos = [
    {
      id: 1,
      idOperacaoOrdem: 100,
      idFuncionario: 3,
      dataHoraInicial: '27/07/2026 23:50:00',
      dataHoraFinal: '28/07/2026 00:10:00',
      quantidade: '50.000000',
      unidadeMedida: 'METRO QUADRADO',
    },
  ]
  const dia27 = montarRelatorioProducao({ operacoes: OPERACOES, apontamentos, inicio: '2026-07-27', fim: '2026-07-27' })
  assert.equal(dia27.totalApontamentos, 0)

  const dia28 = montarRelatorioProducao({ operacoes: OPERACOES, apontamentos, inicio: '2026-07-28', fim: '2026-07-28' })
  assert.equal(dia28.totalApontamentos, 1)
})

test('inicio/fim cobrindo varios dias soma tudo dentro do intervalo, inclusive nas pontas', () => {
  const apontamentos = [
    { id: 1, idOperacaoOrdem: 100, dataHoraInicial: '25/07/2026 08:00:00', dataHoraFinal: '25/07/2026 09:00:00', quantidade: '10', unidadeMedida: 'M2' },
    { id: 2, idOperacaoOrdem: 100, dataHoraInicial: '27/07/2026 08:00:00', dataHoraFinal: '27/07/2026 09:00:00', quantidade: '20', unidadeMedida: 'M2' },
    { id: 3, idOperacaoOrdem: 100, dataHoraInicial: '30/07/2026 08:00:00', dataHoraFinal: '30/07/2026 09:00:00', quantidade: '40', unidadeMedida: 'M2' },
  ]
  const r = montarRelatorioProducao({ operacoes: OPERACOES, apontamentos, inicio: '2026-07-25', fim: '2026-07-27' })
  assert.equal(r.totalApontamentos, 2)
  assert.deepEqual(r.porCentro[0].quantidades, [{ unidade: 'M2', total: 30 }])
})

test('apontamento sem operacao conhecida (idOperacaoOrdem nao bate) cai em "Sem centro de trabalho", nao quebra', () => {
  const apontamentos = [
    { id: 1, idOperacaoOrdem: 999999, dataHoraInicial: '27/07/2026 08:00:00', dataHoraFinal: '27/07/2026 09:00:00', quantidade: '10', unidadeMedida: 'M2' },
  ]
  const r = montarRelatorioProducao({ operacoes: OPERACOES, apontamentos, inicio: '2026-07-27', fim: '2026-07-27' })
  assert.equal(r.porCentro[0].centro, 'Sem centro de trabalho')
  assert.equal(r.porCentro[0].ordens, 0)
})

test('resolve nome do funcionario por idFuncionario no detalhado; sem funcionarios informados, fica null', () => {
  const apontamentos = [
    { id: 1, idOperacaoOrdem: 100, idFuncionario: 3, dataHoraInicial: '27/07/2026 08:00:00', dataHoraFinal: '27/07/2026 09:00:00', quantidade: '10', unidadeMedida: 'M2' },
  ]
  const comFuncionario = montarRelatorioProducao({ operacoes: OPERACOES, apontamentos, funcionarios: FUNCIONARIOS, inicio: '2026-07-27', fim: '2026-07-27' })
  assert.equal(comFuncionario.detalhado[0].funcionario, 'DIOGO RODRIGO ESPINDOLA FRANCO')

  const semFuncionario = montarRelatorioProducao({ operacoes: OPERACOES, apontamentos, inicio: '2026-07-27', fim: '2026-07-27' })
  assert.equal(semFuncionario.detalhado[0].funcionario, null)
})

test('detalhado vem ordenado do mais recente pro mais antigo (por dataHoraFinal)', () => {
  const apontamentos = [
    { id: 1, idOperacaoOrdem: 100, dataHoraInicial: '27/07/2026 08:00:00', dataHoraFinal: '27/07/2026 09:00:00', quantidade: '10', unidadeMedida: 'M2' },
    { id: 2, idOperacaoOrdem: 100, dataHoraInicial: '27/07/2026 10:00:00', dataHoraFinal: '27/07/2026 11:00:00', quantidade: '10', unidadeMedida: 'M2' },
  ]
  const r = montarRelatorioProducao({ operacoes: OPERACOES, apontamentos, inicio: '2026-07-27', fim: '2026-07-27' })
  assert.deepEqual(r.detalhado.map((d) => d.id), [2, 1])
})

test('sem apontamentos no periodo, devolve listas vazias sem quebrar', () => {
  const r = montarRelatorioProducao({ operacoes: OPERACOES, apontamentos: [], inicio: '2026-07-27', fim: '2026-07-27' })
  assert.deepEqual(r, { porCentro: [], detalhado: [], totalApontamentos: 0 })
})
