import test from 'node:test'
import assert from 'node:assert/strict'
import { lerQuantidadeBr, somarQuantidadeApontada, validarQuantidade, mensagemQuantidadeAcima } from './quantidade.js'

test('lerQuantidadeBr entende o texto brasileiro do Nomus', () => {
  assert.equal(lerQuantidadeBr('21'), 21)
  assert.equal(lerQuantidadeBr('15,6'), 15.6)
  assert.equal(lerQuantidadeBr('1,5428'), 1.5428)
  assert.equal(lerQuantidadeBr('1.287,64'), 1287.64)
  assert.equal(lerQuantidadeBr(30), 30)
  assert.equal(lerQuantidadeBr(''), null)
  assert.equal(lerQuantidadeBr(null), null)
  assert.equal(lerQuantidadeBr('abc'), null)
})

test('somarQuantidadeApontada le o ponto decimal dos apontamentos ("21.000000" nao e 21 milhoes)', () => {
  assert.equal(somarQuantidadeApontada([{ quantidade: '21.000000' }, { quantidade: '42.000000' }]), 63)
  assert.equal(somarQuantidadeApontada([{ quantidade: '0.000000' }, {}]), 0)
  assert.equal(somarQuantidadeApontada(undefined), 0)
})

test('validarQuantidade: acima da ordem e recusado, igual ou abaixo passa', () => {
  assert.deepEqual(validarQuantidade({ quantidade: 21, qtdePlanejada: '21' }), { ok: true })
  assert.deepEqual(validarQuantidade({ quantidade: 20.5, qtdePlanejada: '21' }), { ok: true })
  assert.deepEqual(validarQuantidade({ quantidade: 42, qtdePlanejada: '21' }), { ok: false, maximo: 21, restante: 21 })
  assert.equal(validarQuantidade({ quantidade: 21.0001, qtdePlanejada: '21' }).ok, false)
})

test('validarQuantidade com casas decimais da ordem (1,5428) nao erra por ponto flutuante', () => {
  assert.equal(validarQuantidade({ quantidade: 1.5428, qtdePlanejada: '1,5428' }).ok, true)
  assert.equal(validarQuantidade({ quantidade: 1.5429, qtdePlanejada: '1,5428' }).ok, false)
  assert.equal(validarQuantidade({ quantidade: 0.1 + 0.2, qtdePlanejada: '0,3' }).ok, true)
})

test('validarQuantidade desconta o que ja foi apontado', () => {
  assert.deepEqual(validarQuantidade({ quantidade: 12, qtdePlanejada: '21', jaApontada: 10 }), { ok: false, maximo: 21, restante: 11 })
  assert.equal(validarQuantidade({ quantidade: 11, qtdePlanejada: '21', jaApontada: 10 }).ok, true)
  assert.equal(validarQuantidade({ quantidade: 12, qtdePlanejada: '21', jaApontada: 10 }).ok, false)
})

test('validarQuantidade nao trava sem dado: sem qtdePlanejada legivel ou sem quantidade', () => {
  assert.equal(validarQuantidade({ quantidade: 999, qtdePlanejada: undefined }).ok, true)
  assert.equal(validarQuantidade({ quantidade: 999, qtdePlanejada: '' }).ok, true)
  assert.equal(validarQuantidade({ quantidade: 0, qtdePlanejada: '21' }).ok, true)
  assert.equal(validarQuantidade({ quantidade: undefined, qtdePlanejada: '21' }).ok, true)
})

test('mensagem diz o que foi informado, o maximo da ordem e quanto ainda pode', () => {
  const msg = mensagemQuantidadeAcima({ nomeOrdem: 'OS 02764 - 001' }, 42, { maximo: 21, restante: 21 })
  assert.match(msg, /informada \(42\)/)
  assert.match(msg, /OS 02764 - 001/)
  assert.match(msg, /\(21\)/)
  assert.match(msg, /Informe no máximo 21\./)
  const comJa = mensagemQuantidadeAcima({ nomeOrdem: 'OS 1' }, 12, { maximo: 21, restante: 11 }, 10)
  assert.match(comJa, /já apontado 10/)
  assert.match(comJa, /no máximo 11\./)
})
