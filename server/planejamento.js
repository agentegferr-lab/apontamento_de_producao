import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

/**
 * Quadro de planejamento do PCP — um calendario mensal onde ordens ainda intocadas
 * (a "fila invisivel" do kanban, ver server/kanban.js) sao arrastadas pra um dia especifico.
 *
 * Isto e SO NOSSO: nunca vai pro Nomus (nao existe campo de API confirmado pra isso — ver
 * o incidente do "reporte de producao"). E puramente uma ferramenta de organizacao interna,
 * do mesmo jeito que server/andamento.js guarda o "em andamento" que tambem nao existe no
 * Nomus. Guarda um retrato (nomeOrdem/pedido/produto) tirado na hora de agendar — se esses
 * dados mudarem depois no Nomus, o card no calendario nao atualiza sozinho, mas tambem nao
 * quebra nem some so porque a ordem finalmente comecou a ser produzida.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_PLANEJAMENTO
  ? path.resolve(process.env.ARQUIVO_PLANEJAMENTO)
  : path.join(__dirname, '..', 'dados', 'planejamento.json')

let itens = []

function carregar() {
  try {
    const bruto = fs.readFileSync(ARQUIVO, 'utf8')
    const dados = JSON.parse(bruto)
    itens = Array.isArray(dados) ? dados : []
    console.log(`[planejamento] ${itens.length} item(ns) de planejamento recuperado(s)`)
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.error(`[planejamento] ARQUIVO ILEGIVEL (${ARQUIVO}) — subindo vazio:`, erro.message)
    }
    itens = []
  }
}

function gravar() {
  const temporario = `${ARQUIVO}.tmp`
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
  fs.writeFileSync(temporario, JSON.stringify(itens, null, 2), 'utf8')
  fs.renameSync(temporario, ARQUIVO)
}

carregar()

export const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/

export const planejamento = {
  listar() {
    return [...itens]
  },

  /**
   * Agenda uma operacao pra um dia. Idempotente por idOperacaoOrdem: soltar a mesma ordem
   * de novo (ex.: duplo evento de drop) so devolve o registro ja existente, sem duplicar.
   */
  agendar({
    idOrdem,
    idOperacaoOrdem,
    nomeOrdem,
    pedido,
    idProduto,
    produto,
    codigoProduto,
    quantidade,
    unidadeMedida,
    data,
  }) {
    const existente = itens.find((i) => Number(i.idOperacaoOrdem) === Number(idOperacaoOrdem))
    if (existente) return existente

    const registro = {
      id: crypto.randomUUID(),
      idOrdem: Number(idOrdem),
      idOperacaoOrdem: Number(idOperacaoOrdem),
      nomeOrdem,
      pedido: pedido ?? null,
      // id interno do PRODUTO no Nomus — usado pra explodir a lista de materiais (BOM) sob
      // demanda (ver server/materiais.js); nao persiste a receita em si, so este id.
      idProduto: idProduto != null ? Number(idProduto) : null,
      produto: produto ?? null,
      codigoProduto: codigoProduto ?? null,
      quantidade: quantidade ?? null,
      unidadeMedida: unidadeMedida ?? null,
      data,
      criadoEm: new Date().toISOString(),
    }
    itens.push(registro)
    gravar()
    return registro
  },

  /** Move um item ja agendado pra outro dia (arrastar de um dia pro outro no calendario). */
  mover(id, novaData) {
    const registro = itens.find((i) => i.id === id)
    if (!registro) return null
    registro.data = novaData
    gravar()
    return registro
  },

  /** Tira do calendario (arrastar de volta pra fila, ou o "x" do card). */
  remover(id) {
    const antes = itens.length
    itens = itens.filter((i) => i.id !== id)
    if (itens.length !== antes) gravar()
    return antes !== itens.length
  },
}
