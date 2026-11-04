import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

/**
 * Registro de CANCELAMENTOS de apontamento feitos pelo terminal (botao "Cancelar apontamento"):
 *  - GRAVADO: apontamento ja gravado no Nomus, movido pra lixeira
 *    (`PUT /apontamentos/moverParaLixeira/{id}`, "desativa" o apontamento);
 *  - EM_ANDAMENTO: processo ainda aberto no terminal, descartado sem nunca ter ido pro Nomus.
 *
 * Serve a dois fins: auditoria (quem cancelou, quando, o que era e por que) e uma lista dos ids
 * movidos pra lixeira — o app ignora esses ids mesmo que o Nomus ainda os devolva numa listagem,
 * pra um apontamento cancelado nunca voltar a contar (nem travar um novo apontamento da etapa).
 * Mesmo padrao JSON local dos outros modulos (dados/, fora do Git).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_CANCELAMENTOS
  ? path.resolve(process.env.ARQUIVO_CANCELAMENTOS)
  : path.join(__dirname, '..', 'dados', 'cancelamentos.json')

let itens = []
try {
  const dados = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'))
  itens = Array.isArray(dados) ? dados : []
} catch (erro) {
  if (erro.code !== 'ENOENT') console.error(`[cancelamentos] ARQUIVO ILEGIVEL (${ARQUIVO}) — subindo vazio:`, erro.message)
}

function gravar() {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
  fs.writeFileSync(`${ARQUIVO}.tmp`, JSON.stringify(itens, null, 2), 'utf8')
  fs.renameSync(`${ARQUIVO}.tmp`, ARQUIVO)
}

// Ids movidos pra lixeira FORA do terminal (correcao manual), versionados pra valerem em qualquer
// servidor sem copiar arquivo de dados. Ver server/cancelamentos-fixos.json.
const ARQUIVO_FIXOS = process.env.ARQUIVO_CANCELAMENTOS_FIXOS
  ? path.resolve(process.env.ARQUIVO_CANCELAMENTOS_FIXOS)
  : path.join(__dirname, 'cancelamentos-fixos.json')
let fixos = []
try {
  fixos = (JSON.parse(fs.readFileSync(ARQUIVO_FIXOS, 'utf8')).ids ?? []).map(Number)
} catch (erro) {
  if (erro.code !== 'ENOENT') console.error(`[cancelamentos] ids fixos ilegiveis (${ARQUIVO_FIXOS}):`, erro.message)
}

let idsCancelados = new Set([
  ...fixos,
  ...itens.flatMap((i) => (i.tipo === 'GRAVADO' ? (i.cancelados ?? []).map(Number) : [])),
])

export const cancelamentos = {
  /** Guarda um cancelamento. `entrada.cancelados` (ids movidos pra lixeira) alimenta a lista de ignorados. */
  registrar(entrada) {
    const registro = { id: crypto.randomUUID(), em: new Date().toISOString(), ...entrada }
    itens.push(registro)
    for (const id of registro.tipo === 'GRAVADO' ? (registro.cancelados ?? []) : []) idsCancelados.add(Number(id))
    gravar()
    return registro
  },
  /** Ids de apontamento ja movidos pra lixeira (o app nao deve mais contar nenhum deles). */
  idsApontamentosCancelados() {
    return idsCancelados
  },
  listar() {
    return [...itens].reverse()
  },
}
