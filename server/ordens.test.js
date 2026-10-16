import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscarJanela, compactarOrdem, resolverPedidoDoRuim } from './ordens.js'

const erro400 = () => Object.assign(new Error('400'), { status: 400 })

// Nomus de mentira: devolve as ordens com id em [de, ate) e responde 400 se a janela
// contiver algum id "ruim" — o comportamento real confirmado em 2026-10-16.
function nomusFalso(ids, ruinsNoNomus = []) {
  const chamadas = []
  const buscar = async (de, ate) => {
    chamadas.push([de, ate])
    if (ruinsNoNomus.some((r) => r >= de && r < ate)) throw erro400()
    return ids.filter((id) => id >= de && id < ate && !ruinsNoNomus.includes(id)).map((id) => ({ id }))
  }
  return { buscar, chamadas }
}

test('janela sadia: uma chamada so', async () => {
  const { buscar, chamadas } = nomusFalso([1, 2, 3])
  const r = await buscarJanela(0, 50, buscar, new Map())
  assert.deepEqual(r.map((o) => o.id), [1, 2, 3])
  assert.equal(chamadas.length, 1)
})

test('janela com id ruim: isola o ruim, devolve todo o resto e lembra o id', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => 1800 + i)
  const { buscar } = nomusFalso(ids, [1804, 1814])
  const ruins = new Map()
  const r = await buscarJanela(1800, 1850, buscar, ruins)
  assert.equal(r.length, 48)
  assert.equal(r.some((o) => o.id === 1804 || o.id === 1814), false)
  assert.deepEqual([...ruins.keys()].sort(), [1804, 1814])
})

test('ruim ja conhecido e pulado sem gastar chamada nenhuma nele', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => 1800 + i)
  const { buscar, chamadas } = nomusFalso(ids, [1804])
  const ruins = new Map([[1804, Date.now()]])
  const r = await buscarJanela(1800, 1850, buscar, ruins)
  assert.equal(r.length, 49)
  assert.equal(chamadas.length, 2) // [1800,1804) e [1805,1850), nunca o 1804
  assert.equal(chamadas.some(([de, ate]) => de <= 1804 && 1804 < ate), false)
})

test('ruim conhecido ha mais de 24h e tentado de novo', async () => {
  const { buscar, chamadas } = nomusFalso([1804], [])
  const ruins = new Map([[1804, Date.now() - 25 * 60 * 60 * 1000]])
  const r = await buscarJanela(1800, 1810, buscar, ruins)
  assert.deepEqual(r.map((o) => o.id), [1804])
  assert.equal(chamadas.length, 1)
})

test('erro que nao e 400 (429, rede) sobe em vez de virar "id ruim"', async () => {
  const buscar = async () => {
    throw Object.assign(new Error('429'), { status: 429 })
  }
  const ruins = new Map()
  await assert.rejects(() => buscarJanela(0, 50, buscar, ruins), /429/)
  assert.equal(ruins.size, 0)
})

test('compactarOrdem guarda so o que o resto do servidor usa', () => {
  const c = compactarOrdem({
    id: 7,
    nome: 'OS 00007 - 001',
    idProduto: 3,
    descricaoProduto: 'TELHA',
    codigoProduto: 'PA 1',
    qtde: '2,5',
    unidadeMedida: 'M2',
    status: 'Confirmada',
    infAdProduto: 'texto grande que nao precisa ficar',
    itensPedido: [{ id: 9, idPedido: 1357, item: '00010', nomeCliente: 'FULANO', quantidade: '2,5' }],
  })
  assert.deepEqual(c.itensPedido, [{ idPedido: 1357, item: '00010', nomeCliente: 'FULANO' }])
  assert.equal(c.infAdProduto, undefined)
  assert.equal(c.status, 'Confirmada')
})

test('resolverPedidoDoRuim acha o id do pedido por bisseccao em poucas chamadas', async () => {
  const pedidoReal = 1321
  let chamadas = 0
  const dentro = async (_id, a, b) => {
    chamadas++
    return pedidoReal >= a && pedidoReal < b
  }
  assert.equal(await resolverPedidoDoRuim(1804, 1, 2200, dentro), pedidoReal)
  assert.ok(chamadas <= 14, `gastou ${chamadas} chamadas`)
})

test('resolverPedidoDoRuim devolve null quando a ordem nao tem pedido na faixa', async () => {
  assert.equal(await resolverPedidoDoRuim(1, 1, 2200, async () => false), null)
})
