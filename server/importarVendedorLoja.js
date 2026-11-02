/**
 * Le o texto do vendedorLoja.ts da intranet da GFERRO e devolve o conteudo de
 * dados/vendedor-loja.json (ver server/lojas.js). So a ESTRUTURA e conhecida aqui — nenhum nome
 * de vendedor ou loja fica no codigo; os dados vem do arquivo que a pessoa aponta.
 * Leva so id/nome das lojas (a meta de vendas da intranet nao e usada neste app).
 */

/** Trecho entre `nomeDaConstante ... = {` e o `};` que fecha o objeto. */
function blocoDoObjeto(texto, nomeDaConstante) {
  const ini = texto.search(new RegExp(`const\\s+${nomeDaConstante}\\b[^=]*=\\s*\\{`))
  if (ini < 0) return ''
  const abre = texto.indexOf('{', texto.indexOf('=', ini))
  const fecha = texto.indexOf('};', abre)
  return fecha < 0 ? '' : texto.slice(abre + 1, fecha)
}

/** Pares chave -> id de um bloco "Nome": 'id', (chave com ou sem aspas). */
function paresDoBloco(bloco) {
  const pares = {}
  const re = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([\p{L}_][\p{L}\p{N}_]*))\s*:\s*['"]([^'"]+)['"]\s*,?\s*(?:\/\/.*)?$/gmu
  for (const m of bloco.matchAll(re)) {
    const chave = (m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1')
    pares[chave] = m[4]
  }
  return pares
}

export function extrairTabelaDeLojas(textoTs) {
  const lojas = []
  const iniLojas = textoTs.search(/export\s+const\s+LOJAS\b/)
  if (iniLojas >= 0) {
    const bloco = textoTs.slice(iniLojas, textoTs.indexOf('] as const', iniLojas) >= 0 ? textoTs.indexOf('] as const', iniLojas) : undefined)
    for (const m of bloco.matchAll(/\{\s*id:\s*'([^']+)'\s*,\s*nome:\s*'([^']+)'/g)) lojas.push({ id: m[1], nome: m[2] })
  }
  return {
    lojas,
    vendedores: paresDoBloco(blocoDoObjeto(textoTs, 'VENDEDOR_LOJA')),
    vendedoresPorPrimeiroNome: paresDoBloco(blocoDoObjeto(textoTs, 'VENDEDOR_LOJA_POR_PRIMEIRO_NOME')),
  }
}
