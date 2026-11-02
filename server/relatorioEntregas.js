import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { nomus } from './nomus.js'
import { lerQuantidadeBr } from './quantidade.js'
import { chaveDoPedido } from './materiaisPedido.js'
import { carregarTabelaDeLojas, SEM_LOJA } from './lojas.js'
import { entregas } from './entregas.js'
import { motoristas } from './motoristas.js'
import { caminhoes } from './caminhoes.js'
import { gerarPdfEntregasCompleto } from './relatorioEntregasPdf.js'
import PDFDocument from 'pdfkit'

/**
 * Relatorio COMPLETO de entregas: cada pedido entregue no periodo, ligado ao vendedor e a loja
 * dele, ao motorista, e se houve recebimento NA ENTREGA (e quanto). Agrupado por loja, com o
 * resumo por motorista no final. O PDF sai de server/relatorioEntregasPdf.js.
 *
 * Fontes:
 *  - entregas, motorista e caminhao: o proprio app (dados/entregas.json);
 *  - valor do pedido e vendedor: Nomus (/pedidos -> idPessoaVendedor -> /pessoas/{id}.nome);
 *  - loja: tabela vendedor->loja local (server/lojas.js), que vem da intranet da GFERRO;
 *  - recebimento: contas a receber do Nomus do pedido (/contasReceber, descricaoLancamento
 *    "Pedido PD n - Parcela x de y"), com `dataBaixa` e `valorRecebido` — mesma fonte que a
 *    intranet usa pro financeiro.
 *
 * "Recebido NA ENTREGA" = baixas cuja data e o DIA da entrega. O que entrou antes aparece como
 * "recebido antes" (ex.: entrada paga na venda) e o que ainda falta como "em aberto".
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO_CACHE = process.env.ARQUIVO_CACHE_RELATORIO_PEDIDOS
  ? path.resolve(process.env.ARQUIVO_CACHE_RELATORIO_PEDIDOS)
  : path.join(__dirname, '..', 'dados', 'cache-relatorio-pedidos.json')

const arredondar = (n) => Math.round(n * 100) / 100

/** "16/10/2026" ou "16/10/2026 10:25:57" -> "2026-10-16"; null se nao der pra ler. */
export function dataNomusParaIso(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(valor ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Codigo digitado ("2019", "PD 02019") -> "PD 02019", o formato do Nomus. */
export function codigoNomusDoPedido(pedido) {
  const chave = chaveDoPedido(pedido)
  return chave ? `PD ${chave.padStart(5, '0')}` : null
}

/** A conta e mesmo desse pedido? (a busca por `*PD 02158*` tambem traria "PD 021580"). */
export function contaEDoPedido(conta, pedido) {
  const chave = chaveDoPedido(pedido)
  const m = /\bPD\s*0*(\d+)\b/i.exec(String(conta?.descricaoLancamento ?? ''))
  return Boolean(chave && m && String(Number(m[1])) === chave)
}

/** Parcela "a cobrar na entrega"? A equipe marca a observacao da parcela: ENTREGA, "PAGAR NA ENTREGA"... */
export function parcelaEhDaEntrega(parcela) {
  const obs = String(parcela?.observacao ?? '')
  return /entrega/i.test(obs) && !/retira/i.test(obs)
}

/** "Parcela 2 de 3" na descricao da conta a receber -> 2; null se nao tiver. */
export function numeroDaParcela(conta) {
  const m = /Parcela\s+(\d+)\s+de\s+\d+/i.exec(String(conta?.descricaoLancamento ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * Resume a cobranca/recebimento de um pedido em relacao a entrega.
 *
 * Regra principal: as parcelas do PEDIDO cuja observacao diz ENTREGA sao o que se cobra na
 * entrega (valor + forma de pagamento); o contas a receber diz se aquela parcela foi mesmo
 * recebida (a conta "Parcela N de M" e a N-esima parcela do pedido, `valorRecebido`). ENTRADA /
 * 100% PAGO sao recebimentos antecipados ("antes"). Pedido sem nenhuma parcela marcada ENTREGA
 * (ex.: cadastrado fora desse costume) cai no criterio de reserva: baixa no DIA da entrega.
 *
 * @param contas         contas a receber do pedido no Nomus (`valorRecebido` em texto BR)
 * @param dataEntregaIso "AAAA-MM-DD"
 * @param valorPedido    valor total do pedido (numero) ou null
 * @param parcelas       parcelas do pedido: [{ observacao, valor (numero), idFormaPagamento }]
 * @param nomeDaForma    (idFormaPagamento) => nome da forma ("Pix", "Dinheiro"...)
 */
export function resumirRecebimento(contas, dataEntregaIso, valorPedido = null, parcelas = [], nomeDaForma = () => null) {
  const recebidoDaConta = (c) => (c?.status === false ? 0 : (lerQuantidadeBr(c?.valorRecebido) ?? 0))
  const contasValidas = (contas ?? []).filter((c) => recebidoDaConta(c) > 0)
  const total = arredondar(contasValidas.reduce((soma, c) => soma + recebidoDaConta(c), 0))
  const emAberto = valorPedido != null ? arredondar(Math.max(0, valorPedido - total)) : null

  const doPedido = (parcelas ?? []).map((p, i) => ({ ...p, numero: i + 1 }))
  const daEntrega = doPedido.filter(parcelaEhDaEntrega)

  let cobranca = 0
  let recebidoNaEntrega = 0
  const formas = new Set()
  let criterio = 'parcela'
  if (daEntrega.length > 0) {
    for (const p of daEntrega) {
      cobranca += p.valor ?? 0
      const recebido = contasValidas.filter((c) => numeroDaParcela(c) === p.numero).reduce((soma, c) => soma + recebidoDaConta(c), 0)
      recebidoNaEntrega += recebido
      const forma = nomeDaForma(p.idFormaPagamento)
      if (forma) formas.add(forma)
    }
  } else {
    criterio = 'dia'
    for (const c of contasValidas) {
      if (dataNomusParaIso(c.dataBaixa) === dataEntregaIso) {
        recebidoNaEntrega += recebidoDaConta(c)
        if (c.nomeFormaPagamento) formas.add(c.nomeFormaPagamento)
      }
    }
    cobranca = recebidoNaEntrega
  }
  cobranca = arredondar(cobranca)
  recebidoNaEntrega = arredondar(recebidoNaEntrega)
  const antes = arredondar(Math.max(0, total - recebidoNaEntrega))

  let situacao = 'NAO'
  if (cobranca > 0 && recebidoNaEntrega >= cobranca - 0.01) situacao = 'RECEBIDO'
  else if (recebidoNaEntrega > 0) situacao = 'PARCIAL'
  else if (cobranca > 0) situacao = 'A_RECEBER'
  else if (antes > 0 && emAberto != null && emAberto <= 0.01) situacao = 'PAGO_ANTES'
  return { cobranca, naEntrega: recebidoNaEntrega, antes, total, emAberto, formas: [...formas], situacao, criterio }
}

/**
 * Junta o lancamento de entrega com o que se sabe do pedido. `info` = { encontrado, valorTotal,
 * vendedor } (do Nomus) e `contas` = contas a receber; `tabelaLojas` vem de carregarTabelaDeLojas().
 */
export function montarLinha(entrega, { nomeMotorista, placaCaminhao }, info, contas, tabelaLojas, nomeDaForma = () => null) {
  const valorPedido = info?.encontrado ? info.valorTotal : (entrega.valor ?? null)
  const loja = info?.vendedor ? tabelaLojas.lojaDoVendedor(info.vendedor) : SEM_LOJA
  return {
    data: entrega.data,
    pedido: entrega.pedido,
    cliente: entrega.cliente ?? null,
    metragem: entrega.metragem ?? null,
    motorista: nomeMotorista ?? '—',
    caminhao: placaCaminhao ?? '—',
    vendedor: info?.vendedor ?? null,
    loja,
    pedidoEncontrado: Boolean(info?.encontrado),
    valorPedido,
    recebimento: resumirRecebimento(contas, entrega.data, valorPedido, info?.parcelas ?? [], nomeDaForma),
  }
}

const somar = (linhas, campo) => arredondar(linhas.reduce((s, l) => s + (campo(l) ?? 0), 0))

/**
 * Totais de um conjunto de linhas. Metragem e numero de entregas contam TODAS as linhas; mas o
 * valor do pedido e o recebimento sao do PEDIDO — um pedido entregue em duas viagens aparece
 * em duas linhas e nao pode somar o valor duas vezes.
 */
export function totaisDasLinhas(linhas) {
  const porPedido = new Map()
  for (const l of linhas) {
    const chave = chaveDoPedido(l.pedido) ?? l.pedido
    if (!porPedido.has(chave)) porPedido.set(chave, l)
  }
  const unicos = [...porPedido.values()]
  return {
    entregas: linhas.length,
    pedidos: porPedido.size,
    metragem: somar(linhas, (l) => l.metragem),
    valorPedidos: somar(unicos, (l) => l.valorPedido),
    recebidoNaEntrega: somar(unicos, (l) => l.recebimento.naEntrega),
    comRecebimentoNaEntrega: unicos.filter((l) => l.recebimento.naEntrega > 0).length,
    aReceberNaEntrega: somar(unicos, (l) => Math.max(0, l.recebimento.cobranca - l.recebimento.naEntrega)),
    emAberto: somar(unicos, (l) => l.recebimento.emAberto),
  }
}

const porDataEPedido = (a, b) => String(a.data).localeCompare(String(b.data)) || String(a.pedido).localeCompare(String(b.pedido), 'pt-BR', { numeric: true })

/** Agrupa por loja (na ordem da tabela; "sem loja" por ultimo) e por motorista. */
export function agruparRelatorio(linhas, tabelaLojas) {
  const porLoja = []
  const ordemLojas = [...tabelaLojas.lojas, SEM_LOJA]
  for (const loja of ordemLojas) {
    const doGrupo = linhas.filter((l) => l.loja.id === loja.id).sort(porDataEPedido)
    if (doGrupo.length > 0) porLoja.push({ loja, linhas: doGrupo, totais: totaisDasLinhas(doGrupo) })
  }
  const nomes = [...new Set(linhas.map((l) => l.motorista))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const porMotorista = nomes.map((motorista) => {
    const doGrupo = linhas.filter((l) => l.motorista === motorista)
    return { motorista, totais: totaisDasLinhas(doGrupo) }
  })
  return { porLoja, porMotorista, total: totaisDasLinhas(linhas) }
}

// --- Coleta no Nomus ----------------------------------------------------------------------

const cachePedidos = new Map() // chave -> { encontrado, valorTotal, vendedor, em }
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(ARQUIVO_CACHE, 'utf8')))) cachePedidos.set(k, v)
} catch (erro) {
  if (erro.code !== 'ENOENT') console.warn('[relatorio-entregas] cache ilegivel, comecando vazio:', erro.message)
}
function persistirCache() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO_CACHE), { recursive: true })
    fs.writeFileSync(`${ARQUIVO_CACHE}.tmp`, JSON.stringify(Object.fromEntries(cachePedidos)), 'utf8')
    fs.renameSync(`${ARQUIVO_CACHE}.tmp`, ARQUIVO_CACHE)
  } catch (erro) {
    console.warn('[relatorio-entregas] falha ao gravar cache:', erro.message)
  }
}
const VALE_PEDIDO_MS = 24 * 60 * 60 * 1000

/** Valor e vendedor do pedido no Nomus (cache de 24h: pedido ja entregue quase nao muda). */
async function dadosDoPedido(pedido) {
  const chave = chaveDoPedido(pedido)
  if (!chave) return { encontrado: false }
  const guardado = cachePedidos.get(chave)
  if (guardado && Date.now() - guardado.em < VALE_PEDIDO_MS && (guardado.parcelas !== undefined || !guardado.encontrado)) return guardado

  const lista = await nomus.obterComPaciencia('/pedidos', { query: `codigoPedido=="${codigoNomusDoPedido(pedido)}"`, pagina: 1 })
  const p = Array.isArray(lista) ? lista[0] : null
  let resultado = { encontrado: false, em: Date.now() }
  if (p) {
    let vendedor = null
    if (p.idPessoaVendedor != null) {
      const pessoa = await nomus.obterComPaciencia(`/pessoas/${p.idPessoaVendedor}`)
      vendedor = pessoa?.nome ?? null
    }
    const parcelas = (p.parcelas ?? []).map((par) => ({
      observacao: par.observacao ?? '',
      valor: lerQuantidadeBr(par.valorParcela) ?? 0,
      idFormaPagamento: par.idFormaPagamento ?? null,
    }))
    resultado = { encontrado: true, valorTotal: lerQuantidadeBr(p.valorTotal), vendedor, parcelas, em: Date.now() }
  }
  cachePedidos.set(chave, resultado)
  persistirCache()
  return resultado
}

/** id -> nome das formas de pagamento do Nomus ("Pix", "Dinheiro"...); lista pequena, lida uma vez. */
let formasPorId = null
async function nomesDasFormas() {
  if (formasPorId) return formasPorId
  const lista = await nomus.obterComPaciencia('/formasPagamento', { pagina: 1 })
  formasPorId = new Map((Array.isArray(lista) ? lista : []).map((f) => [f.id, f.nome]))
  return formasPorId
}

/** Contas a receber do pedido (sempre do Nomus: o recebimento muda, nao se guarda). */
async function contasDoPedido(pedido) {
  const codigo = codigoNomusDoPedido(pedido)
  if (!codigo) return []
  const lista = await nomus.obterComPaciencia('/contasReceber', { query: `descricaoLancamento=="*${codigo}*"`, pagina: 1 })
  return (Array.isArray(lista) ? lista : []).filter((c) => contaEDoPedido(c, pedido))
}

// --- Trabalho em segundo plano (varios pedidos = varias consultas ao Nomus) ----------------

const trabalhos = new Map() // id -> { status, feitos, total, erro, pdf, nomeArquivo, criadoEm }
const VALE_TRABALHO_MS = 60 * 60 * 1000

function limparTrabalhosAntigos() {
  for (const [id, t] of trabalhos) if (Date.now() - t.criadoEm > VALE_TRABALHO_MS) trabalhos.delete(id)
}

function gerarBuffer(dados) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape', bufferPages: true })
    const partes = []
    doc.on('data', (p) => partes.push(p))
    doc.on('end', () => resolve(Buffer.concat(partes)))
    doc.on('error', reject)
    gerarPdfEntregasCompleto(doc, dados)
    doc.end()
  })
}

/** Dispara a geracao e devolve o id; acompanhe por obterTrabalho(id). */
export function iniciarRelatorio({ inicio, fim, rotulo }) {
  limparTrabalhosAntigos()
  const doPeriodo = entregas.listar().filter((e) => e.data >= inicio && e.data <= fim)
  const id = crypto.randomUUID()
  const trabalho = { status: 'coletando', feitos: 0, total: doPeriodo.length, erro: null, pdf: null, nomeArquivo: `relatorio-entregas-${inicio}-a-${fim}.pdf`, criadoEm: Date.now() }
  trabalhos.set(id, trabalho)

  ;(async () => {
    const nomeMotorista = new Map(motoristas.listar().map((m) => [m.id, m.nome]))
    const placaCaminhao = new Map(caminhoes.listar().map((c) => [c.id, c.placa]))
    const tabelaLojas = carregarTabelaDeLojas()
    const formas = await nomesDasFormas()
    const nomeDaForma = (id) => formas.get(id) ?? null
    const linhas = []
    for (const e of doPeriodo) {
      const [info, contas] = await Promise.all([dadosDoPedido(e.pedido), contasDoPedido(e.pedido)])
      linhas.push(montarLinha(e, { nomeMotorista: nomeMotorista.get(e.motoristaId), placaCaminhao: placaCaminhao.get(e.caminhaoId) }, info, contas, tabelaLojas, nomeDaForma))
      trabalho.feitos += 1
    }
    const agrupado = agruparRelatorio(linhas, tabelaLojas)
    trabalho.pdf = await gerarBuffer({
      periodoRotulo: rotulo || `${inicio} a ${fim}`,
      geradoEm: new Date().toLocaleString('pt-BR'),
      agrupado,
      semTabelaDeLojas: !tabelaLojas.temDados,
      vendedoresSemLoja: [...new Set(linhas.filter((l) => l.loja.id === SEM_LOJA.id && l.vendedor).map((l) => l.vendedor))].sort(),
    })
    trabalho.status = 'pronto'
  })().catch((erro) => {
    console.error('[relatorio-entregas] falhou:', erro)
    trabalho.status = 'erro'
    trabalho.erro = erro.message
  })
  return id
}

export function obterTrabalho(id) {
  return trabalhos.get(id) ?? null
}
