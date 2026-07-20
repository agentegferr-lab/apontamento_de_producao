/**
 * Monta o quadro de acompanhamento a partir de tres fontes:
 *   1. o roteiro de cada ordem            (GET /rest/operacoesRoteiroOrdem)
 *   2. o que ja foi apontado no Nomus     (GET /rest/apontamentos)
 *   3. o que esta em andamento agora      (store local — nao existe no Nomus, ver andamento.js)
 *
 * Regra da coluna: a ordem aparece no centro de trabalho da sua primeira operacao ainda
 * NAO apontada. E isso que faz o card andar sozinho — fechou o corte, a proxima pendente
 * passa a ser a pintura e a ordem muda de coluna sem ninguem arrastar nada.
 */

export const STATUS = {
  EM_PRODUCAO: 'EM_PRODUCAO',
  PARADO: 'PARADO', // iniciado, mas pausado agora (refeicao, quebra de maquina...)
  AGUARDANDO: 'AGUARDANDO',
  CONCLUIDO: 'CONCLUIDO',
}

/** O Nomus ora devolve o centro como texto, ora como objeto {id, nome}. */
export function nomeCentro(centro) {
  if (!centro) return null
  if (typeof centro === 'string') return centro.trim() || null
  return centro.nome?.trim() || null
}

const SEM_CENTRO = 'Sem centro de trabalho'

/** Operacoes sao ordenadas por numero ("10" antes de "20"); texto vai pro fim, em ordem alfabetica. */
function ordenarOperacoes(ops) {
  return [...ops].sort((a, b) => {
    const na = Number(a.operacao)
    const nb = Number(b.operacao)
    const aNum = Number.isFinite(na)
    const bNum = Number.isFinite(nb)
    if (aNum && bNum) return na - nb
    if (aNum) return -1
    if (bNum) return 1
    return String(a.operacao ?? '').localeCompare(String(b.operacao ?? ''))
  })
}

/**
 * Datas vindas do Nomus (GET /apontamentos) sao "DD/MM/YYYY HH:mm:ss" — confirmado com um
 * POST de teste real (ver server/index.js, paraFormatoNomus). `Date.parse` NAO interpreta
 * esse formato de forma confiavel (o motor pode ler como MM/DD americano e inverter dia e
 * mes silenciosamente) — por isso o parse e manual aqui, nao Date.parse.
 */
export function parseDataNomus(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(valor ?? '').trim())
  if (!m) return null
  const [, dia, mes, ano, hora, min, seg] = m.map(Number)
  const data = new Date(ano, mes - 1, dia, hora, min, seg)
  return Number.isNaN(data.getTime()) ? null : data
}

function duracaoMs(apontamento) {
  const inicio = parseDataNomus(apontamento.dataHoraInicial)
  const fim = parseDataNomus(apontamento.dataHoraFinal)
  return inicio && fim ? Math.max(0, fim.getTime() - inicio.getTime()) : 0
}

/**
 * A ordem das colunas sai dos proprios dados: cada centro herda o menor numero de operacao
 * em que aparece nos roteiros. Corte (10) vem antes de Pintura (20) naturalmente, sem
 * lista fixa no codigo — abriu um centro novo no Nomus, ele entra na posicao certa.
 */
export function ordenarColunas(operacoes) {
  const posicao = new Map()
  for (const op of operacoes) {
    const centro = nomeCentro(op.centroTrabalhoPlanejado) ?? SEM_CENTRO
    const n = Number(op.operacao)
    const atual = posicao.get(centro)
    const valor = Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
    if (atual === undefined || valor < atual) posicao.set(centro, valor)
  }
  return [...posicao.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([c]) => c)
}

/**
 * @param pedidosPorOrdem  Map idOrdem -> {pedido, cliente}. Vem de outros dois endpoints do
 *                         Nomus (ver pedidos.js); vazio quando indisponivel, e o card so
 *                         mostra a OS.
 */
export function montarKanban({ operacoes, apontamentos, emAndamento, pedidosPorOrdem = new Map() }) {
  const apontadas = new Set()
  const tempoPorOrdem = new Map()
  for (const apt of apontamentos) {
    apontadas.add(Number(apt.idOperacaoOrdem))
  }

  const porOperacao = new Map()
  for (const op of operacoes) porOperacao.set(Number(op.id), op)

  // Soma o tempo ja gravado por ordem (so conta apontamento que casa com uma operacao conhecida).
  for (const apt of apontamentos) {
    const op = porOperacao.get(Number(apt.idOperacaoOrdem))
    if (!op) continue
    const chave = Number(op.idOrdem)
    tempoPorOrdem.set(chave, (tempoPorOrdem.get(chave) ?? 0) + duracaoMs(apt))
  }

  const andamentoPorOperacao = new Map()
  for (const a of emAndamento) andamentoPorOperacao.set(Number(a.idOperacaoOrdem), a)

  const ordens = new Map()
  for (const op of operacoes) {
    const chave = Number(op.idOrdem)
    if (!ordens.has(chave)) ordens.set(chave, [])
    ordens.get(chave).push(op)
  }

  const cards = []
  const filaAguardando = []
  const concluidos = []
  for (const [idOrdem, ops] of ordens) {
    const roteiro = ordenarOperacoes(ops)

    // Etapa que alguem esta produzindo AGORA ganha da "primeira pendente". No fluxo normal
    // sao a mesma coisa. Mas se alguem comecar a pintura antes de o corte ser apontado, a
    // regra crua deixaria o card parado no corte como AGUARDANDO — escondendo do quadro um
    // trabalho que esta acontecendo. O que esta aberto e a verdade do chao de fabrica.
    const emProducao = roteiro.find((op) => andamentoPorOperacao.has(Number(op.id)))
    const pendente = roteiro.find((op) => !apontadas.has(Number(op.id)))
    const referencia = emProducao ?? pendente ?? roteiro[roteiro.length - 1]
    if (!referencia) continue

    const aberto = andamentoPorOperacao.get(Number(referencia.id)) ?? null
    const parado = aberto?.estado === 'PAUSADO'
    const status = aberto
      ? parado
        ? STATUS.PARADO
        : STATUS.EM_PRODUCAO
      : !pendente
        ? STATUS.CONCLUIDO
        : STATUS.AGUARDANDO

    const etapasConcluidas = roteiro.filter((op) => apontadas.has(Number(op.id))).length

    const pedidoInfo = pedidosPorOrdem.get(idOrdem)
    const card = {
      idOrdem,
      nomeOrdem: referencia.nomeOrdem,
      pedido: pedidoInfo?.pedido ?? null,
      // id interno do pedido (nao o codigo textual acima) — disponivel na hora, direto da
      // ordem, sem depender da busca lenta ao Nomus. Usar isto pra agrupar/deduplicar por
      // pedido (ver TelaKanban.jsx); `pedido` textual e so pra exibicao.
      idPedido: pedidoInfo?.idPedido ?? null,
      // id interno do PRODUTO no Nomus (nao o codigo textual abaixo) — usado pra explodir a
      // lista de materiais (BOM) na tela de Planejamento (ver server/materiais.js).
      idProduto: pedidoInfo?.idProduto ?? null,
      produto: pedidoInfo?.produto ?? null,
      codigoProduto: pedidoInfo?.codigoProduto ?? null,
      // Cru do Nomus (ex. "1.287,64" — ponto de milhar, virgula decimal). Quem soma/formata
      // e o cliente, ver client/src/numero.js.
      quantidade: pedidoInfo?.quantidade ?? null,
      unidadeMedida: pedidoInfo?.unidadeMedida ?? null,
      // Status de requisicao de material da ordem (Planejada/Confirmada/Liberada/...) — nao
      // confundir com `status` acima, que e o status de PRODUCAO calculado por este modulo.
      statusOrdem: pedidoInfo?.statusOrdem ?? null,
      // Status do ITEM do pedido de VENDA (1=Aguardando liberacao, 2=Liberado — ver
      // pedidos.js). Fonte de verdade pro KPI "liberado sem producao"; diferente de
      // `statusOrdem` (requisicao de material da ordem) e de `status` (producao).
      statusItemPedido: pedidoInfo?.statusItemPedido ?? null,
      // Valor TOTAL do pedido (nao so do item desta OS) — cru do Nomus, ver pedidos.js.
      valorTotal: pedidoInfo?.valorTotal ?? null,
      descricao: referencia.descricao,
      operacao: referencia.operacao,
      idOperacaoOrdem: referencia.id,
      coluna: nomeCentro(referencia.centroTrabalhoPlanejado) ?? SEM_CENTRO,
      status,
      // Cronometro vivo: o cliente conta a partir daqui. Ausente quando nao ha nada aberto.
      // Parado, ele conta ha quanto tempo a producao esta parada — que e o que interessa ver.
      dataHoraInicial: aberto?.dataHoraInicial ?? null,
      operadorAtual: aberto?.nomeFuncionario ?? null,
      motivoParada: parado ? (aberto.paradaAtual?.nomeAtividade ?? 'Parado') : null,
      tempoGravadoMs: tempoPorOrdem.get(idOrdem) ?? 0,
      etapasConcluidas,
      totalEtapas: roteiro.length,
    }

    // OS que nunca teve NENHUMA etapa iniciada (nem apontada, nem em andamento) vai pra
    // fila invisivel, nao pro quadro visivel — sem isso, toda a fila de producao ainda
    // intocada (que pode ser centenas de ordens) lota a 1a coluna do roteiro e afoga o que
    // realmente importa olhar: o que esta em producao, parado, ou prestes a concluir.
    if (status === STATUS.AGUARDANDO && etapasConcluidas === 0) {
      filaAguardando.push(card)
    } else if (status === STATUS.CONCLUIDO) {
      // Ordem que terminou o roteiro inteiro sai do quadro visivel — senao o card fica
      // acumulando pra sempre na ultima coluna. Segue o mesmo padrao da filaAguardando:
      // some da tela, mas continua disponivel na API pra uma tela futura de historico.
      concluidos.push(card)
    } else {
      cards.push(card)
    }
  }

  const ordemDasColunas = ordenarColunas(operacoes)
  const colunas = ordemDasColunas.map((nome) => ({
    nome,
    cards: cards
      .filter((c) => c.coluna === nome)
      // Quem esta produzindo aparece primeiro, parado logo abaixo (e o que pede acao do
      // supervisor), depois o que espera, e concluido por ultimo.
      .sort((a, b) => {
        const peso = {
          [STATUS.EM_PRODUCAO]: 0,
          [STATUS.PARADO]: 1,
          [STATUS.AGUARDANDO]: 2,
          [STATUS.CONCLUIDO]: 3,
        }
        return peso[a.status] - peso[b.status] || String(a.nomeOrdem).localeCompare(String(b.nomeOrdem))
      }),
  }))

  return {
    colunas: colunas.filter((c) => c.cards.length > 0 || ordemDasColunas.length <= 12),
    // Nenhum dos dois e renderizado no kanban (ver client/src/components/TelaKanban.jsx) —
    // existem so pra guardar o dado, caso uma tela futura precise mostrar fila ou historico.
    filaAguardando,
    concluidos,
  }
}
