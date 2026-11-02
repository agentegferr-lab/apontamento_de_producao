import { chaveDoPedido } from './materiaisPedido.js'
import { SEM_LOJA } from './lojas.js'

/**
 * Relatorio de PRAZO de entrega: a data prometida no Nomus x a data real da entrega, por loja.
 *
 * - Data prometida: a data de entrega dos ITENS do pedido no Nomus (gravada na venda); com mais
 *   de uma data entre os itens vale a MAIS TARDIA (o pedido so esta completo quando o ultimo
 *   item chega). Sem data nos itens, cai na "data de entrega padrao" do cabecalho. O Nomus so
 *   guarda a data ATUAL: se a PCP reprogramou o pedido, vale a data reprogramada.
 * - Data real: a PRIMEIRA entrega lancada do pedido no periodo (lancamentos repetidos do mesmo
 *   pedido costumam ser registro duplicado, entao a primeira e a que conta).
 * - Atraso em dias CORRIDOS (nao uteis): entrega depois do prazo = atrasado; no dia ou antes =
 *   no prazo.
 */

/** "18/11/2026" ou "18/11/2026 00:00:00" -> "2026-11-18"; null se nao der pra ler. */
export function dataNomusParaIso(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(valor ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Data prometida (ISO) de um pedido do Nomus: item mais tardio; senao a data padrao; senao null. */
export function dataPrometidaDoPedido(pedido) {
  const dosItens = (pedido?.itensPedido ?? []).map((i) => dataNomusParaIso(i?.dataEntrega)).filter(Boolean).sort()
  if (dosItens.length > 0) return { iso: dosItens.at(-1), origem: 'itens' }
  const padrao = dataNomusParaIso(pedido?.dataEntregaPadrao)
  return padrao ? { iso: padrao, origem: 'padrao' } : { iso: null, origem: null }
}

/** Dias corridos de `deIso` ate `paraIso` (positivo se `para` e depois). */
export function diasEntre(deIso, paraIso) {
  const [a1, m1, d1] = deIso.split('-').map(Number)
  const [a2, m2, d2] = paraIso.split('-').map(Number)
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000)
}

/** Situacao da entrega frente ao prazo. */
export function classificarPrazo(prazoIso, realIso) {
  if (!prazoIso || !realIso) return { situacao: 'SEM_PRAZO', diasAtraso: 0, diasAntecipado: 0 }
  const dif = diasEntre(prazoIso, realIso)
  if (dif > 0) return { situacao: 'ATRASADO', diasAtraso: dif, diasAntecipado: 0 }
  return { situacao: 'NO_PRAZO', diasAtraso: 0, diasAntecipado: Math.max(0, -dif) }
}

/**
 * Uma linha por PEDIDO a partir dos lancamentos de entrega: data real = a primeira; guarda
 * quantas vezes foi lancado (>1 merece conferencia).
 */
export function consolidarEntregasPorPedido(entregas) {
  const porPedido = new Map()
  const ordenadas = [...entregas].sort((a, b) => String(a.data).localeCompare(String(b.data)))
  for (const e of ordenadas) {
    const chave = chaveDoPedido(e.pedido) ?? String(e.pedido)
    const atual = porPedido.get(chave)
    if (!atual) {
      porPedido.set(chave, { chave, pedido: e.pedido, dataReal: e.data, lancamentos: 1, datas: [e.data], cliente: e.cliente ?? null, motorista: e.motorista ?? '—' })
    } else {
      atual.lancamentos += 1
      atual.datas.push(e.data)
      if (!atual.cliente && e.cliente) atual.cliente = e.cliente
    }
  }
  return [...porPedido.values()]
}

/** Junta o pedido consolidado com o que o Nomus diz (prazo, vendedor) e a loja do vendedor. */
export function montarLinhaPrazo(consolidado, info, tabelaLojas) {
  const prazoIso = info?.encontrado ? (info.prazoIso ?? null) : null
  const loja = info?.vendedor ? tabelaLojas.lojaDoVendedor(info.vendedor) : SEM_LOJA
  return {
    ...consolidado,
    pedidoEncontrado: Boolean(info?.encontrado),
    vendedor: info?.vendedor ?? null,
    loja,
    prazoIso,
    prazoOrigem: info?.prazoOrigem ?? null,
    modificadoEm: info?.modificadoEm ?? null,
    ...classificarPrazo(prazoIso, consolidado.dataReal),
  }
}

/** Totais de um conjunto de linhas de pedido. */
export function totaisDoPrazo(linhas) {
  const comPrazo = linhas.filter((l) => l.situacao !== 'SEM_PRAZO')
  const atrasados = linhas.filter((l) => l.situacao === 'ATRASADO')
  const dias = atrasados.reduce((s, l) => s + l.diasAtraso, 0)
  const pct = (n) => (comPrazo.length > 0 ? Math.round((n / comPrazo.length) * 1000) / 10 : null)
  const noPrazo = comPrazo.length - atrasados.length
  return {
    pedidos: linhas.length,
    comPrazo: comPrazo.length,
    semPrazo: linhas.length - comPrazo.length,
    noPrazo,
    atrasados: atrasados.length,
    pctNoPrazo: pct(noPrazo),
    pctAtrasados: pct(atrasados.length),
    diasAtrasoTotal: dias,
    mediaAtraso: atrasados.length > 0 ? Math.round((dias / atrasados.length) * 10) / 10 : 0,
    maiorAtraso: atrasados.reduce((m, l) => Math.max(m, l.diasAtraso), 0),
  }
}

// Atrasados primeiro (mais dias antes), depois os demais por data de entrega.
const porAtraso = (a, b) =>
  (b.situacao === 'ATRASADO') - (a.situacao === 'ATRASADO') ||
  b.diasAtraso - a.diasAtraso ||
  String(a.dataReal).localeCompare(String(b.dataReal)) ||
  String(a.pedido).localeCompare(String(b.pedido), 'pt-BR', { numeric: true })

/** Agrupa por loja (na ordem da tabela; "sem loja" por ultimo). */
export function agruparPrazo(linhas, tabelaLojas) {
  const porLoja = []
  for (const loja of [...tabelaLojas.lojas, SEM_LOJA]) {
    const doGrupo = linhas.filter((l) => l.loja.id === loja.id).sort(porAtraso)
    if (doGrupo.length > 0) porLoja.push({ loja, linhas: doGrupo, totais: totaisDoPrazo(doGrupo) })
  }
  return {
    porLoja,
    total: totaisDoPrazo(linhas),
    repetidos: linhas.filter((l) => l.lancamentos > 1).map((l) => ({ pedido: l.pedido, lancamentos: l.lancamentos, datas: l.datas })),
  }
}
