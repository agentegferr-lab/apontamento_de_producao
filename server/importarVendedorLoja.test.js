import test from 'node:test'
import assert from 'node:assert/strict'
import { extrairTabelaDeLojas } from './importarVendedorLoja.js'

// Arquivo FICTICIO no mesmo formato do vendedorLoja.ts da intranet (nomes inventados).
const TS = `
export const LOJAS = [
  { id: 'a', nome: 'Unidade A — Fulano', metaVendas: 100000 },
  { id: 'b', nome: 'Unidade B', metaVendas: 200000 },
] as const satisfies readonly Loja[];

const VENDEDOR_LOJA: Record<string, string> = {
  'MARIA EXEMPLO': 'a',
  'João D\\'Teste': 'b',
  Ágata: 'b',
  "Com Aspas Duplas": 'a',
};

const VENDEDOR_LOJA_POR_PRIMEIRO_NOME: Record<string, string> = {
  'FULANO': 'a',
  CICLANO: 'b',
};

function normalizar(texto: string): string { return texto; }
`

test('extrairTabelaDeLojas le lojas (so id/nome), vendedores e primeiros nomes', () => {
  const t = extrairTabelaDeLojas(TS)
  assert.deepEqual(t.lojas, [
    { id: 'a', nome: 'Unidade A — Fulano' },
    { id: 'b', nome: 'Unidade B' },
  ])
  assert.deepEqual(t.vendedores, { 'MARIA EXEMPLO': 'a', "João D'Teste": 'b', Ágata: 'b', 'Com Aspas Duplas': 'a' })
  assert.deepEqual(t.vendedoresPorPrimeiroNome, { FULANO: 'a', CICLANO: 'b' })
})

test('extrairTabelaDeLojas devolve vazio quando o arquivo nao tem o formato esperado', () => {
  const t = extrairTabelaDeLojas('const outra = {};')
  assert.deepEqual(t, { lojas: [], vendedores: {}, vendedoresPorPrimeiroNome: {} })
})
