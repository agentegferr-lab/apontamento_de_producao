import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.ARQUIVO_ENTREGAS = path.join(os.tmpdir(), `entregas-teste-${process.pid}.json`)
process.env.ARQUIVO_MOTORISTAS = path.join(os.tmpdir(), `entregas-motoristas-teste-${process.pid}.json`)
process.env.ARQUIVO_CAMINHOES = path.join(os.tmpdir(), `entregas-caminhoes-teste-${process.pid}.json`)
for (const arquivo of [process.env.ARQUIVO_ENTREGAS, process.env.ARQUIVO_MOTORISTAS, process.env.ARQUIVO_CAMINHOES]) {
  fs.rmSync(arquivo, { force: true })
}

const { entregas, validarLancamento } = await import('./entregas.js')
const { motoristas } = await import('./motoristas.js')
const { caminhoes } = await import('./caminhoes.js')

const motorista = motoristas.criar({ nome: 'Joao' })
const motoristaInativo = motoristas.atualizar(motoristas.criar({ nome: 'Pedro' }).id, { ativo: false })
const caminhao = caminhoes.criar({ placa: 'ABC1234' })

function buscadores() {
  return { buscarMotorista: (id) => motoristas.obter(id), buscarCaminhao: (id) => caminhoes.obter(id) }
}

test('validarLancamento: motorista/caminhao precisam existir e estar ativos', () => {
  assert.throws(
    () => validarLancamento({ motoristaId: 'x', caminhaoId: caminhao.id, data: '2026-07-25', pedidos: ['1'] }, buscadores()),
    /Motorista nao encontrado/,
  )
  assert.throws(
    () =>
      validarLancamento(
        { motoristaId: motoristaInativo.id, caminhaoId: caminhao.id, data: '2026-07-25', pedidos: ['1'] },
        buscadores(),
      ),
    /inativo/,
  )
  assert.throws(
    () => validarLancamento({ motoristaId: motorista.id, caminhaoId: 'x', data: '2026-07-25', pedidos: ['1'] }, buscadores()),
    /Caminhao nao encontrado/,
  )
})

test('validarLancamento: data precisa ser AAAA-MM-DD', () => {
  assert.throws(
    () => validarLancamento({ motoristaId: motorista.id, caminhaoId: caminhao.id, data: '25/07/2026', pedidos: ['1'] }, buscadores()),
    /formato AAAA-MM-DD/,
  )
})

test('validarLancamento: pedidos nao pode vir vazio, mas ignora strings em branco', () => {
  assert.throws(
    () => validarLancamento({ motoristaId: motorista.id, caminhaoId: caminhao.id, data: '2026-07-25', pedidos: [] }, buscadores()),
    /ao menos um pedido/,
  )
  assert.throws(
    () =>
      validarLancamento({ motoristaId: motorista.id, caminhaoId: caminhao.id, data: '2026-07-25', pedidos: ['  ', ''] }, buscadores()),
    /ao menos um pedido/,
  )
  // Formato antigo (string solta) ainda funciona — vira o mesmo shape, so com os campos extras null.
  const valido = validarLancamento(
    { motoristaId: motorista.id, caminhaoId: caminhao.id, data: '2026-07-25', pedidos: [' PD 01038 ', '', 'PD 00922'] },
    buscadores(),
  )
  assert.deepEqual(valido.pedidos, [
    { pedido: 'PD 01038', metragem: null, valor: null, cliente: null },
    { pedido: 'PD 00922', metragem: null, valor: null, cliente: null },
  ])
})

test('validarLancamento: aceita metragem/valor/cliente por pedido, ignora numero invalido', () => {
  const valido = validarLancamento(
    {
      motoristaId: motorista.id,
      caminhaoId: caminhao.id,
      data: '2026-07-25',
      pedidos: [
        { pedido: 'PD 01038', metragem: 15.5, valor: 1200, cliente: ' Fulano de Tal ' },
        { pedido: 'PD 00922', metragem: 'abc', valor: '', cliente: '' },
      ],
    },
    buscadores(),
  )
  assert.deepEqual(valido.pedidos, [
    { pedido: 'PD 01038', metragem: 15.5, valor: 1200, cliente: 'Fulano de Tal' },
    { pedido: 'PD 00922', metragem: null, valor: null, cliente: null },
  ])
})

test('lancar cria um registro por pedido, todos com o mesmo motorista/caminhao/data, preservando metragem/valor/cliente', () => {
  const antes = entregas.listar().length
  const criados = entregas.lancar({
    motoristaId: motorista.id,
    caminhaoId: caminhao.id,
    data: '2026-07-25',
    pedidos: [
      { pedido: 'PD 01038', metragem: 10, valor: 500, cliente: 'Cliente A' },
      { pedido: 'PD 00922' },
    ],
  })
  assert.equal(criados.length, 2)
  assert.ok(criados.every((c) => c.motoristaId === motorista.id && c.caminhaoId === caminhao.id && c.data === '2026-07-25'))
  assert.equal(criados[0].metragem, 10)
  assert.equal(criados[0].valor, 500)
  assert.equal(criados[0].cliente, 'Cliente A')
  assert.equal(criados[1].metragem, null)
  assert.notEqual(criados[0].id, criados[1].id)
  assert.equal(entregas.listar().length, antes + 2)
})
