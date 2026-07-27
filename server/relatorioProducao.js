import { nomeCentro, ordenarColunas, parseDataNomus } from './kanban.js'

/**
 * Relatorio de producao por centro de trabalho (Corte, Pintura...) num periodo — separado
 * do kanban.js porque aquele monta o quadro ATUAL (o que falta fazer); este olha pro
 * HISTORICO ja apontado (o que ja foi feito), reaproveitando os mesmos helpers de data/centro.
 *
 * `quantidade` de um apontamento e o total daquele SEGMENTO — a API do Nomus manda tudo no
 * ULTIMO segmento de uma operacao (segmentos intermediarios, de pausa/retomada, vem com
 * quantidade 0 — ver server/index.js, POST /apontamentos) — entao somar `quantidade` de
 * todos os segmentos do periodo ja da o total certo, sem contar em dobro.
 *
 * Um apontamento conta pro dia em que TERMINOU (dataHoraFinal), nao em que comecou — e o
 * instante em que a quantidade foi de fato registrada. Um turno que atravessa a meia-noite
 * conta pro dia em que fechou o apontamento.
 */

function chaveDoDia(data) {
  const p = (n) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`
}

const SEM_CENTRO = 'Sem centro de trabalho'

export function montarRelatorioProducao({ operacoes, apontamentos, funcionarios = [], inicio, fim }) {
  const porOperacao = new Map(operacoes.map((o) => [Number(o.id), o]))
  const nomePorFuncionario = new Map(funcionarios.map((f) => [Number(f.id), f.nome]))
  const ordemCentros = ordenarColunas(operacoes)

  const doPeriodo = apontamentos.filter((a) => {
    const dataFim = parseDataNomus(a.dataHoraFinal)
    if (!dataFim) return false
    const chave = chaveDoDia(dataFim)
    return chave >= inicio && chave <= fim
  })

  const porCentro = new Map()
  const detalhado = []

  for (const apt of doPeriodo) {
    const op = porOperacao.get(Number(apt.idOperacaoOrdem))
    const centro = op ? (nomeCentro(op.centroTrabalhoPlanejado) ?? SEM_CENTRO) : SEM_CENTRO
    const quantidade = Number(apt.quantidade) || 0
    const unidade = apt.unidadeMedida?.trim() || null
    const dataInicial = parseDataNomus(apt.dataHoraInicial)
    const dataFinal = parseDataNomus(apt.dataHoraFinal)
    const duracaoMs = dataInicial && dataFinal ? Math.max(0, dataFinal.getTime() - dataInicial.getTime()) : 0

    if (!porCentro.has(centro)) {
      porCentro.set(centro, { centro, quantidadePorUnidade: new Map(), ordens: new Set(), apontamentos: 0, tempoMs: 0 })
    }
    const agregado = porCentro.get(centro)
    agregado.apontamentos += 1
    agregado.tempoMs += duracaoMs
    if (op) agregado.ordens.add(Number(op.idOrdem))
    if (quantidade > 0 && unidade) {
      agregado.quantidadePorUnidade.set(unidade, (agregado.quantidadePorUnidade.get(unidade) ?? 0) + quantidade)
    }

    detalhado.push({
      id: apt.id,
      centro,
      idOrdem: op?.idOrdem ?? null,
      nomeOrdem: op?.nomeOrdem ?? null,
      operacao: op?.operacao ?? null,
      descricaoEtapa: op?.descricao ?? null,
      quantidade: quantidade > 0 ? quantidade : null,
      unidadeMedida: quantidade > 0 ? unidade : null,
      funcionario: nomePorFuncionario.get(Number(apt.idFuncionario)) ?? null,
      dataHoraInicial: apt.dataHoraInicial,
      dataHoraFinal: apt.dataHoraFinal,
      duracaoMs,
    })
  }

  const porCentroLista = [...porCentro.values()]
    .map((c) => ({
      centro: c.centro,
      apontamentos: c.apontamentos,
      ordens: c.ordens.size,
      tempoMs: c.tempoMs,
      quantidades: [...c.quantidadePorUnidade.entries()].map(([unidade, total]) => ({ unidade, total })),
    }))
    .sort((a, b) => {
      const pa = ordemCentros.indexOf(a.centro)
      const pb = ordemCentros.indexOf(b.centro)
      if (pa === -1 && pb === -1) return a.centro.localeCompare(b.centro)
      if (pa === -1) return 1
      if (pb === -1) return -1
      return pa - pb
    })

  detalhado.sort((a, b) => (b.dataHoraFinal ?? '').localeCompare(a.dataHoraFinal ?? '') || (b.id ?? 0) - (a.id ?? 0))

  return { porCentro: porCentroLista, detalhado, totalApontamentos: doPeriodo.length }
}
