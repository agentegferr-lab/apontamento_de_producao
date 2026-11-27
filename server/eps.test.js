import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.ARQUIVO_EPS = path.join(os.tmpdir(), `eps-teste-${process.pid}.json`)
fs.rmSync(process.env.ARQUIVO_EPS, { force: true })

const { eps, calcularEps, tipoPorId, resumirEps, TIPOS_EPS } = await import('./eps.js')

const ana = { id: 7, nome: 'Ana Teste', matricula: '12' }
const beto = { id: 8, nome: 'Beto Teste', matricula: '13' }

test('bloco 1000x1200x2000: trapezio 84 placas de 1 m a 5,70; forro 42 de 2 m a 19,20', () => {
  assert.deepEqual(TIPOS_EPS.map((t) => [t.id, t.placasPorBloco, t.comprimentoM, t.valorPlaca]), [
    ['TRAPEZIO_TR25', 84, 1, 5.7],
    ['TRAPEZIO_TR40', 84, 1, 5.7],
    ['FORRO_TR25', 42, 2, 19.2],
    ['FORRO_TR40', 42, 2, 19.2],
  ])
  // preco por metro: 5,70 no trapezio e 9,60 no forro
  assert.deepEqual(TIPOS_EPS.map((t) => +(t.valorPlaca / t.comprimentoM).toFixed(2)), [5.7, 5.7, 9.6, 9.6])
})

test('calcularEps: esperado, perda (negativa) e rendimento', () => {
  const c = calcularEps(tipoPorId('TRAPEZIO_TR25'), 5, 190)
  assert.equal(c.esperado, 420)
  assert.equal(c.diferenca, -230)
  assert.equal(c.rendimento, 190 / 420)
  assert.equal(calcularEps(tipoPorId('FORRO_TR40'), 3, 126).esperado, 126)
})

test('lancar grava com o calculo e o colaborador', () => {
  const r = eps.lancar({ tipo: 'TRAPEZIO_TR25', blocos: '5', placas: '400', colaborador: ana, observacao: ' refile ' })
  assert.equal(r.blocos, 5)
  assert.equal(r.placas, 400)
  assert.equal(r.esperado, 420)
  assert.equal(r.diferenca, -20)
  assert.equal(r.metros, 400)
  assert.equal(r.valor, 2280)
  assert.equal(r.observacao, 'refile')
  assert.equal(r.colaborador.nome, 'Ana Teste')
  assert.match(r.data, /^\d{4}-\d{2}-\d{2}$/)
})

test('valida tipo, blocos e placas', () => {
  assert.throws(() => eps.lancar({ tipo: 'X', blocos: 1, placas: 1, colaborador: ana }), /tipo/i)
  assert.throws(() => eps.lancar({ tipo: 'FORRO_TR25', blocos: 0, placas: 1, colaborador: ana }), /blocos/i)
  assert.throws(() => eps.lancar({ tipo: 'FORRO_TR25', blocos: 1.5, placas: 1, colaborador: ana }), /inteiro/)
  assert.throws(() => eps.lancar({ tipo: 'FORRO_TR25', blocos: 1, placas: -1, colaborador: ana }), /placas/i)
  assert.throws(() => eps.lancar({ tipo: 'FORRO_TR25', blocos: 1, placas: 10, colaborador: ana, data: '03/11/2026' }), /AAAA-MM-DD/)
})

test('placas acima do esperado pedem confirmacao (409); com confirmacao grava', () => {
  assert.throws(
    () => eps.lancar({ tipo: 'FORRO_TR25', blocos: 2, placas: 85, colaborador: ana }),
    (e) => e.status === 409 && e.codigo === 'EXCESSO_SOBRE_ESPERADO',
  )
  const r = eps.lancar({ tipo: 'FORRO_TR25', blocos: 2, placas: 85, colaborador: ana, confirmarExcesso: true })
  assert.equal(r.diferenca, 1)
  assert.equal(r.metros, 170)
  assert.equal(r.valor, 1632)
})

test('listar filtra por periodo e esconde cancelados; cancelar fica na auditoria', () => {
  const antigo = eps.lancar({ tipo: 'FORRO_TR40', blocos: 1, placas: 20, colaborador: beto, data: '2026-01-05' })
  assert.deepEqual(eps.listar({ inicio: '2026-01-01', fim: '2026-01-31' }).map((i) => i.id), [antigo.id])
  eps.cancelar(antigo.id, { por: 'Admin' })
  assert.equal(eps.listar({ inicio: '2026-01-01', fim: '2026-01-31' }).length, 0)
  assert.throws(() => eps.cancelar(antigo.id), /não encontrado/)
  const gravado = JSON.parse(fs.readFileSync(process.env.ARQUIVO_EPS, 'utf8')).find((i) => i.id === antigo.id)
  assert.equal(gravado.cancelado, true)
  assert.equal(gravado.canceladoPor, 'Admin')
})

test('resumirEps: total, por tipo, por colaborador e por dia', () => {
  const lista = [
    { tipo: 'TRAPEZIO_TR25', tipoRotulo: 'Trapézio TR25', blocos: 5, placas: 190, esperado: 200, colaborador: ana, data: '2026-11-03' },
    { tipo: 'FORRO_TR25', tipoRotulo: 'Telha forro TR25', blocos: 2, placas: 40, esperado: 40, colaborador: beto, data: '2026-11-03' },
    { tipo: 'TRAPEZIO_TR25', tipoRotulo: 'Trapézio TR25', blocos: 1, placas: 40, esperado: 40, colaborador: ana, data: '2026-11-04' },
  ]
  const r = resumirEps(lista)
  assert.equal(r.total.blocos, 8)
  assert.equal(r.total.placas, 270)
  assert.equal(r.total.perda, 10)
  assert.equal(r.porTipo.length, 2)
  assert.equal(r.porTipo.find((t) => t.tipo === 'TRAPEZIO_TR25').placas, 230)
  assert.equal(r.porColaborador[0].nome, 'Ana Teste') // mais placas primeiro
  assert.deepEqual(r.porDia.map((d) => d.data), ['2026-11-03', '2026-11-04'])
  assert.equal(resumirEps([]).total.rendimento, null)
  // lancamento antigo (sem valor) entra nas quantidades e nao soma dinheiro
  assert.equal(r.total.valor, 0)
  const comValor = resumirEps([{ ...lista[0], valor: 0.1, metros: 1 }, { ...lista[1], valor: 0.2, metros: 2 }, lista[2]])
  assert.equal(comValor.total.valor, 0.3)
  assert.equal(comValor.total.metros, 3)
})

test.after(() => fs.rmSync(process.env.ARQUIVO_EPS, { force: true }))
