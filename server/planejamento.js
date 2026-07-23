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

function chaveData(data) {
  const p = (n) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`
}

/** Proximo dia util depois de `chave` (AAAA-MM-DD) — pula sabado/domingo. Sem calendario de
 * feriados hoje. Exportada pura pra testar sem depender do relogio real. */
export function proximoDiaUtil(chave) {
  const [ano, mes, dia] = chave.split('-').map(Number)
  const data = new Date(ano, mes - 1, dia)
  do {
    data.setDate(data.getDate() + 1)
  } while (data.getDay() === 0 || data.getDay() === 6) // domingo=0, sabado=6
  return chaveData(data)
}

export const planejamento = {
  listar() {
    return [...itens]
  },

  /**
   * Empurra pro proximo dia util (marcando `atrasado: true`) todo item cuja data ja passou e
   * que `estaIniciado` diz que ainda nao comecou — este modulo nao sabe nada de producao/
   * Nomus de proposito (ver topo do arquivo), entao quem chama resolve isso (ver server/
   * index.js, que ja calcula o mesmo status usado no Acompanhamento). Item ja iniciado nunca
   * se move, mesmo com a data no passado — so fica verde onde estiver (ver client).
   *
   * Roda a cada leitura (nao um cron): se ninguem chamar por dias (fim de semana, servidor
   * desligado), a proxima chamada resolve tudo de uma vez, avancando quantos dias uteis
   * precisar, um de cada vez, ate a data nao estar mais no passado.
   */
  aplicarAtrasos(estaIniciado, hoje = new Date()) {
    const chaveHoje = chaveData(hoje)
    let mudou = false
    for (const item of itens) {
      if (estaIniciado(item.idOperacaoOrdem)) continue
      while (item.data < chaveHoje) {
        item.data = proximoDiaUtil(item.data)
        item.atrasado = true
        mudou = true
      }
    }
    if (mudou) gravar()
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
    idPedido,
    idProduto,
    produto,
    codigoProduto,
    quantidade,
    unidadeMedida,
    valorTotal,
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
      // id interno do pedido no Nomus — usado pra NAO somar o mesmo pedido duas vezes quando
      // mais de uma OS dele cai no mesmo dia (ver client/src/planejamentoCampos.js).
      idPedido: idPedido != null ? Number(idPedido) : null,
      // id interno do PRODUTO no Nomus — usado pra explodir a lista de materiais (BOM) sob
      // demanda (ver server/materiais.js); nao persiste a receita em si, so este id.
      idProduto: idProduto != null ? Number(idProduto) : null,
      produto: produto ?? null,
      codigoProduto: codigoProduto ?? null,
      quantidade: quantidade ?? null,
      unidadeMedida: unidadeMedida ?? null,
      // Valor TOTAL do pedido (nao rateado por item) — cru do Nomus, retrato tirado na hora
      // de agendar, igual quantidade/produto acima (ver comentario no topo do arquivo).
      valorTotal: valorTotal ?? null,
      data,
      criadoEm: new Date().toISOString(),
      // true quando o proprio sistema empurrou o item pro dia seguinte por falta de
      // apontamento (ver aplicarAtrasos acima) — nunca comeca marcado assim.
      atrasado: false,
    }
    itens.push(registro)
    gravar()
    return registro
  },

  /**
   * Move um item ja agendado pra outro dia (arrastar de um dia pro outro no calendario, ou
   * "Mudar programação" no modal de detalhes). Sempre limpa `atrasado`: uma vez que alguem
   * decidiu a data de proposito, nao e mais um empurrao automatico do sistema.
   */
  mover(id, novaData) {
    const registro = itens.find((i) => i.id === id)
    if (!registro) return null
    registro.data = novaData
    registro.atrasado = false
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
