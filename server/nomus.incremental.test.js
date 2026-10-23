import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// Tem que vir ANTES de importar nomus.js: o cache em disco e a config sao lidos no import.
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nomus-inc-'))
process.env.ARQUIVO_CACHE_NOMUS = path.join(pasta, 'cache.json')
process.env.NOMUS_API_KEY = 'chave-de-teste'
process.env.NOMUS_BASE_URL = 'http://nomus.falso/rest'
process.env.CACHE_TTL_MS = '1'

const { nomus, forcarAtualizacao } = await import('./nomus.js')

// Nomus de mentira: /apontamentos devolve do id mais NOVO pro mais antigo, 50 por pagina.
let ids = Array.from({ length: 120 }, (_, i) => 120 - i)
let paginasPedidas = []
let falhasDeRedeRestantes = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  const u = new URL(url)
  const pagina = Number(u.searchParams.get('pagina') ?? 1)
  if (falhasDeRedeRestantes > 0) {
    falhasDeRedeRestantes--
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
  }
  paginasPedidas.push(pagina)
  const fatia = ids.slice((pagina - 1) * 50, pagina * 50).map((id) => ({ id }))
  return new Response(JSON.stringify(fatia), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const esperarAte = async (condicao, ms = 3000) => {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (condicao()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timeout esperando a atualizacao de fundo')
}

test('primeira leitura faz a varredura completa (3 paginas para 120 registros)', async () => {
  const lista = await nomus.apontamentos()
  assert.equal(lista.length, 120)
  assert.deepEqual(paginasPedidas, [1, 2, 3])
})

test('atualizacao seguinte so busca as paginas novas e junta com o que ja tinha', async () => {
  ids = [123, 122, 121, ...ids] // 3 apontamentos novos no topo
  paginasPedidas = []
  await new Promise((r) => setTimeout(r, 5)) // deixa o TTL de 1ms vencer
  const antiga = await nomus.apontamentos() // devolve o velho na hora e atualiza em fundo
  assert.equal(antiga.length, 120)
  await esperarAte(() => paginasPedidas.length >= 2)
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(paginasPedidas.length <= 2, `esperava <= 2 paginas, buscou ${paginasPedidas.length}`)
  await new Promise((r) => setTimeout(r, 5))
  const nova = await nomus.apontamentos()
  assert.equal(nova.length, 123)
  assert.deepEqual(nova.slice(0, 3).map((x) => x.id), [123, 122, 121])
  assert.equal(new Set(nova.map((x) => x.id)).size, 123, 'sem duplicados')
})

test('forcarAtualizacao tambem e incremental (nao refaz as paginas todas)', async () => {
  ids = [124, ...ids]
  paginasPedidas = []
  forcarAtualizacao(['apontamentos'])
  await nomus.apontamentos()
  await esperarAte(() => paginasPedidas.length >= 2)
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(paginasPedidas.length <= 2)
})

test('queda de conexao no meio da varredura e tentada de novo em vez de derrubar tudo', async () => {
  ids = [200, ...ids]
  paginasPedidas = []
  falhasDeRedeRestantes = 1
  forcarAtualizacao(['apontamentos'])
  await nomus.apontamentos()
  await esperarAte(() => paginasPedidas.length >= 2, 6000)
  await new Promise((r) => setTimeout(r, 50))
  const lista = await nomus.apontamentos()
  assert.equal(lista[0].id, 200)
})

test.after(() => {
  globalThis.fetch = realFetch
  fs.rmSync(pasta, { recursive: true, force: true })
})
