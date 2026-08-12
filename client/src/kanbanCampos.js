import { formatarDuracao, parseLocalISO } from './tempo.js'

/** Compartilhado entre TelaKanban e TelaPlanejamento — os dois mostram cards de ordem. */
export const ROTULO_STATUS = {
  EM_PRODUCAO: 'EM PRODUÇÃO',
  PARADO: 'PARADO',
  AGUARDANDO: 'AGUARDANDO',
  CONCLUIDO: 'CONCLUÍDO',
}

export const CLASSE_STATUS = {
  EM_PRODUCAO: 'etiqueta--producao',
  PARADO: 'etiqueta--parado',
  AGUARDANDO: 'etiqueta--aguardando',
  CONCLUIDO: 'etiqueta--concluido',
}

/**
 * Quantas etapas mostrar como feitas no card — DIFERENTE de `card.etapasConcluidas`
 * (server/kanban.js), que so conta etapa com apontamento GRAVADO no Nomus (inicio+fim, ver
 * nomus-api-sem-edicao-apontamento). Isso e correto pro servidor, mas confundia no card: uma
 * ordem EM_PRODUCAO na 1a etapa mostrava "0/4" porque a etapa aberta agora ainda nao tem fim
 * gravado — parecia que nada tinha comecado, mesmo com alguem produzindo bem na frente dos
 * olhos. Aqui soma 1 quando ha uma etapa ABERTA (em producao ou parada) que ainda nao entrou
 * em `etapasConcluidas`, so pra exibicao — nunca usar isto em vez de `etapasConcluidas` pra
 * decidir status/fila, so pra mostrar o numero certo na tela.
 */
export function etapasParaExibir(card) {
  const emAndamento = card.status === 'EM_PRODUCAO' || card.status === 'PARADO'
  const total = card.totalEtapas ?? 0
  return Math.min(total, (card.etapasConcluidas ?? 0) + (emAndamento ? 1 : 0))
}

/**
 * Cronometro do card. Produzindo, conta desde o inicio; parado, conta ha quanto tempo esta
 * parado — que e o numero que interessa a quem olha o quadro. Nas demais situacoes mostra o
 * tempo ja gravado no Nomus.
 */
export function tempoDoCard(card, agora) {
  if ((card.status === 'EM_PRODUCAO' || card.status === 'PARADO') && card.dataHoraInicial) {
    const inicio = parseLocalISO(card.dataHoraInicial)
    if (inicio) return formatarDuracao(agora - inicio)
  }
  return card.tempoGravadoMs > 0 ? formatarDuracao(card.tempoGravadoMs) : '-'
}
