// Gera dados/vendedor-loja.json (tabela vendedor -> loja do relatorio de entregas) a partir do
// arquivo vendedorLoja.ts da intranet da GFERRO. Rode UMA vez (e de novo se a tabela mudar):
//
//   node ferramentas/importar-vendedor-loja.mjs "C:\Users\Admin\Documents\GFERRO INTRANET\src\data\vendedorLoja.ts"
//
// O resultado fica em dados/ (ignorado pelo Git): nome de funcionario + unidade nao vai pro GitHub.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extrairTabelaDeLojas } from '../server/importarVendedorLoja.js'

const origem = process.argv[2]
if (!origem) {
  console.error('Uso: node ferramentas/importar-vendedor-loja.mjs <caminho do vendedorLoja.ts da intranet>')
  process.exit(1)
}
const tabela = extrairTabelaDeLojas(fs.readFileSync(origem, 'utf8'))
if (tabela.lojas.length === 0 || Object.keys(tabela.vendedores).length === 0) {
  console.error('Nao encontrei lojas/vendedores nesse arquivo — confira o caminho e o formato.')
  process.exit(1)
}
const destino = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dados', 'vendedor-loja.json')
fs.mkdirSync(path.dirname(destino), { recursive: true })
fs.writeFileSync(destino, JSON.stringify(tabela, null, 2), 'utf8')
console.log(`ok: ${tabela.lojas.length} loja(s), ${Object.keys(tabela.vendedores).length} vendedor(es) -> ${destino}`)
