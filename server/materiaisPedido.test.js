import test from 'node:test'
import assert from 'node:assert/strict'
import { categorizarMaterial, resumirMateriais, chaveDoPedido, entradaValida } from './materiaisPedido.js'

test('categorizarMaterial reconhece as descricoes reais do catalogo', () => {
  const casos = [
    ['TELHA SANDUICHE TR25 - 1020mm - (GALVALUME) - UMA FACE PINTADA', 'Telha sanduíche'],
    ['TELHA SANDUÍCHE TR40 - 980mm', 'Telha sanduíche'],
    ['TELHA SEMI SAND. TR25 - 1020mm (GALVALUME) - COM PINTURA EXTERNA', 'Telha semi sanduíche'],
    ['TELHA SIMPLES TR40 - 980mm - (GALVALUME) - DUAS FACES PINTADAS', 'Telha simples'],
    ['TELHA FORRO METÁLICO (BRANCO) TR40 - 980mm - COM PINTURA EXTERNA', 'Telha forro'],
    ['TELHA ONDULADA 0,43', 'Telha ondulada'],
    ['TELHA TRAPEZOIDAL QUALQUER', 'Telha'],
    ['PARAFUSO 12 X 1 1/2 AUTOBROCANTE', 'Parafuso'],
    ['PARAFUSO COSTURA 7/8" AUTO-BROCANTE (TELHA/TELHA)', 'Parafuso'],
    ['TELHA TRANSLÚCIDA TR25', 'Telha translúcida'],
    ['CUMIEIRA TR25 CHAPA 0,50', 'Cumeeira'],
    ['CORTE 30 (CALHA/RUFO/PINGADEIRA) SEM PINTURA', 'Calha / rufo'],
    ['TAMPA DA CALHA  - SEM PINTURA', 'Calha / rufo'],
    ['BOCAL - 4" POLEGADAS - SEM PINTURA', 'Calha / rufo'],
    ['ACABAMENTO LATERAL TR40 - (CORTE 25)', 'Calha / rufo'],
    ['FORRO PVC BRANCO 7MM', 'Forro'],
    ['TUBO METALON 30X30', 'Metalon'],
    ['VERGALHÃO CA50 10MM', 'Vergalhão'],
    ['TINTA VERDE 18L', 'Tinta'],
    ['COISA QUE NAO EXISTE NO CATALOGO', 'Outros'],
    [null, 'Outros'],
  ]
  for (const [descricao, esperado] of casos) assert.equal(categorizarMaterial(descricao), esperado, String(descricao))
})

test('resumirMateriais junta categorias sem repetir, na ordem do pedido, e guarda os itens', () => {
  const r = resumirMateriais([
    'TELHA SANDUICHE TR25 - 1020mm',
    'TELHA SANDUICHE TR40 - 980mm',
    'PARAFUSO 12 X 1',
    null,
    '   ',
  ])
  assert.deepEqual(r.categorias, ['Telha sanduíche', 'Parafuso'])
  assert.equal(r.itens.length, 3)
  assert.deepEqual(r.itens[2], { descricao: 'PARAFUSO 12 X 1', categoria: 'Parafuso' })
})

test('resumirMateriais sem itens devolve vazio', () => {
  assert.deepEqual(resumirMateriais([]), { categorias: [], itens: [] })
  assert.deepEqual(resumirMateriais(undefined), { categorias: [], itens: [] })
})

test('chaveDoPedido normaliza "2019", "PD 02019" e "pd02019" para a mesma chave', () => {
  assert.equal(chaveDoPedido('2019'), '2019')
  assert.equal(chaveDoPedido('PD 02019'), '2019')
  assert.equal(chaveDoPedido('pd02019'), '2019')
  assert.equal(chaveDoPedido(''), null)
})

test('entradaValida: material resolvido vale sempre; "nao encontrado" expira em 24h', () => {
  const agora = Date.now()
  assert.equal(entradaValida(null, agora), false)
  assert.equal(entradaValida({ categorias: ['Telha simples'], itens: [], em: agora - 365 * 24 * 3600 * 1000 }, agora), true)
  assert.equal(entradaValida({ categorias: [], itens: [], naoEncontrado: true, em: agora - 3600 * 1000 }, agora), true)
  assert.equal(entradaValida({ categorias: [], itens: [], naoEncontrado: true, em: agora - 25 * 3600 * 1000 }, agora), false)
})
