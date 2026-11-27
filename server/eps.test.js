import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.ARQUIVO_EPS = path.join(os.tmpdir(), `eps-teste-${process.pid}.json`)
fs.rmSync(process.env.ARQUIVO_EPS, { force: true })

const { eps, calcularEps, emMetros, tipoPorId, resumirEps, TIPOS_EPS } = await import('./eps.js')

const ana = { id: 7, nome: 'Ana Teste', matricula: '12' }
const beto = { id: 8, nome: 'Beto Teste', matricula: '13' }

test('bloco 1000x1200x2000: 84 m por bloco nos dois tipos; R$ 5,70/m trapezio e R$ 9,60/m forro', () => {
  assert.deepEqual(TIPOS_EPS.map((t) => [t.id, t.metrosPorBloco, t.valorMetro]), [
    ['TRAPEZIO_TR25', 84, 5.7],
    ['TRAPEZIO_TR40', 84, 5.7],
    ['FORRO_TR25', 84, 9.6],
    ['FORRO_TR40', 84, 9.6],
  ])
  assert.ok(TIPOS_EPS.every((t) => t.placasPorBloco * t.comprimentoM === t.metrosPorBloco))
})

test('calcularEps: esperado, perda (negativa) e rendimento', () => {
  const c = calcularEps(tipoPorId('TRAPEZIO_TR25'), 5, 190)
  assert.equal(c.esperado, 420)
  assert.equal(c.diferenca, -230)
  assert.equal(c.rendimento, 190 / 420)
  assert.equal(calcularEps(tipoPorId('FORRO_TR40'), 3, 126).esperado, 252)
})

test('lancar grava com o calculo e o colaborador', () => {
  const r = eps.lancar({ tipo: 'TRAPEZIO_TR25', blocos: '5', metros: '400,5', colaborador: ana, observacao: ' refile ' })
  assert.equal(r.blocos, 5)
  assert.equal(r.metros, 400.5)
  assert.equal(r.esperado, 420)
  assert.equal(r.diferenca, -19.5)
  assert.equal(r.valor, 2282.85)
  assert.equal(r.unidade, 'm')
  assert.equal(r.observacao, 'refile')
  assert.equal(r.colaborador.nome, 'Ana Teste')
  assert.match(r.data, /^\d{4}-\d{2}-\d{2}$/)
})

test('valida tipo, blocos e metros', () => {
  assert.throws(() => eps.lancar({ tipo: 'X', blocos: 1, metros: 1, colaborador: ana }), /tipo/i)
  assert.throws(() => eps.lancar({ tipo: 'FORRO_TR25', blocos: 0, metros: 1, colaborador: ana }), /blocos/i)
  assert.throws(() => eps.lancar({ tipo: 'FORRO_TR25', blocos: 1.5, metros: 1, colaborador: ana }), /inteiro/)
  for (const metros of ['', -1, 'abc', '1,000', '1.2.3']) {
    assert.throws(() => eps.lancar({ tipo: 'FORRO_TR25', blocos: 1, metros, colaborador: ana }), /metros/i, String(metros))
  }
  assert.throws(() => eps.lancar({ tipo: 'FORRO_TR25', blocos: 1, metros: 10, colaborador: ana, data: '03/11/2026' }), /AAAA-MM-DD/)
})

test('metros acima do esperado pedem confirmacao (409); com confirmacao grava', () => {
  assert.throws(
    () => eps.lancar({ tipo: 'FORRO_TR25', blocos: 2, metros: 169, colaborador: ana }),
    (e) => e.status === 409 && e.codigo === 'EXCESSO_SOBRE_ESPERADO',
  )
  const r = eps.lancar({ tipo: 'FORRO_TR25', blocos: 2, metros: 169, colaborador: ana, confirmarExcesso: true })
  assert.equal(r.diferenca, 1)
  assert.equal(r.valor, 1622.4)
})

test('listar filtra por periodo e esconde cancelados; cancelar fica na auditoria', () => {
  const antigo = eps.lancar({ tipo: 'FORRO_TR40', blocos: 1, metros: 40, colaborador: beto, data: '2026-01-05' })
  assert.deepEqual(eps.listar({ inicio: '2026-01-01', fim: '2026-01-31' }).map((i) => i.id), [antigo.id])
  eps.cancelar(antigo.id, { por: 'Admin' })
  assert.equal(eps.listar({ inicio: '2026-01-01', fim: '2026-01-31' }).length, 0)
  assert.throws(() => eps.cancelar(antigo.id), /não encontrado/)
  const gravado = JSON.parse(fs.readFileSync(process.env.ARQUIVO_EPS, 'utf8')).find((i) => i.id === antigo.id)
  assert.equal(gravado.cancelado, true)
  assert.equal(gravado.canceladoPor, 'Admin')
})

test('resumirEps: total, por tipo, por colaborador e por dia (em metros)', () => {
  const lista = [
    { tipo: 'TRAPEZIO_TR25', tipoRotulo: 'Trapézio TR25', blocos: 5, metros: 410, esperado: 420, valor: 0.1, colaborador: ana, data: '2026-11-03' },
    { tipo: 'FORRO_TR25', tipoRotulo: 'Telha forro TR25', blocos: 2, metros: 168, esperado: 168, valor: 0.2, colaborador: beto, data: '2026-11-03' },
    { tipo: 'TRAPEZIO_TR25', tipoRotulo: 'Trapézio TR25', blocos: 1, metros: 84, esperado: 84, colaborador: ana, data: '2026-11-04' },
  ]
  const r = resumirEps(lista)
  assert.equal(r.total.blocos, 8)
  assert.equal(r.total.metros, 662)
  assert.equal(r.total.perda, 10)
  assert.equal(r.total.valor, 0.3)
  assert.equal(r.porTipo.length, 2)
  assert.equal(r.porTipo.find((t) => t.tipo === 'TRAPEZIO_TR25').metros, 494)
  assert.equal(r.porColaborador[0].nome, 'Ana Teste') // mais metros primeiro
  assert.deepEqual(r.porDia.map((d) => d.data), ['2026-11-03', '2026-11-04'])
  assert.equal(resumirEps([]).total.rendimento, null)
})

test('lancamento antigo (em placas) aparece convertido pra metros', () => {
  const antigo = { tipo: 'FORRO_TR25', blocos: 1, placas: 40, esperado: 42, diferenca: -2 }
  const m = emMetros(antigo)
  assert.deepEqual([m.metros, m.esperado, m.diferenca, m.unidade], [80, 84, -4, 'm'])
  assert.equal(emMetros(m), m) // ja em metros: nao converte de novo
})

test.after(() => fs.rmSync(process.env.ARQUIVO_EPS, { force: true }))
