import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Vendedor -> loja/unidade. O Nomus NAO tem o conceito de "loja" pros vendedores: essa tabela
 * e mantida a mao nos sistemas da GFERRO (na intranet, em src/data/vendedorLoja.ts).
 *
 * Por ser dado de pessoas (nome de funcionario + unidade), ela NAO fica no codigo nem vai pro
 * Git: vive num arquivo local, dados/vendedor-loja.json (a pasta dados/ ja e ignorada pelo Git).
 * Formato:
 *
 *   {
 *     "lojas": [ { "id": "u1", "nome": "Unidade 1" }, { "id": "u2", "nome": "Unidade 2" } ],
 *     "vendedores": { "Nome Completo Como No Nomus": "u1", "Outro Vendedor": "u2" },
 *     "vendedoresPorPrimeiroNome": { "FULANO": "u2" }
 *   }
 *
 * (`vendedoresPorPrimeiroNome` e opcional — vale quando o vendedor ainda nao tem o nome
 * completo cadastrado no Nomus.) A comparacao ignora acento, caixa e espacos extras. Pra gerar o
 * arquivo a partir da intranet: `node ferramentas/importar-vendedor-loja.mjs <caminho do vendedorLoja.ts>`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ARQUIVO_VENDEDOR_LOJA = process.env.ARQUIVO_VENDEDOR_LOJA
  ? path.resolve(process.env.ARQUIVO_VENDEDOR_LOJA)
  : path.join(__dirname, '..', 'dados', 'vendedor-loja.json')

export const SEM_LOJA = { id: 'sem-loja', nome: 'Sem loja (vendedor não identificado)' }

export function normalizarNome(texto) {
  return String(texto ?? '')
    .replace(/(?:&#x20;|&#32;|&nbsp;)/gi, ' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** Monta o buscador a partir do conteudo do JSON (separado da leitura do disco pra testar). */
export function criarTabelaDeLojas(conteudo) {
  const lojas = Array.isArray(conteudo?.lojas) ? conteudo.lojas : []
  const porNome = new Map(Object.entries(conteudo?.vendedores ?? {}).map(([nome, id]) => [normalizarNome(nome), id]))
  const porPrimeiroNome = new Map(Object.entries(conteudo?.vendedoresPorPrimeiroNome ?? {}).map(([nome, id]) => [normalizarNome(nome), id]))
  return {
    lojas,
    temDados: porNome.size > 0 || porPrimeiroNome.size > 0,
    /** Loja ({ id, nome }) do vendedor, ou SEM_LOJA quando o nome nao esta na tabela. */
    lojaDoVendedor(nomeVendedor) {
      const nome = normalizarNome(nomeVendedor)
      if (!nome) return SEM_LOJA
      const id = porNome.get(nome) ?? porPrimeiroNome.get(nome.split(' ')[0])
      return lojas.find((l) => l.id === id) ?? SEM_LOJA
    },
  }
}

/** Le dados/vendedor-loja.json a cada relatorio (arquivo pequeno; assim uma edicao vale na hora). */
export function carregarTabelaDeLojas() {
  try {
    return criarTabelaDeLojas(JSON.parse(fs.readFileSync(ARQUIVO_VENDEDOR_LOJA, 'utf8')))
  } catch (erro) {
    if (erro.code !== 'ENOENT') console.warn('[lojas] vendedor-loja.json ilegivel:', erro.message)
    return criarTabelaDeLojas({})
  }
}
