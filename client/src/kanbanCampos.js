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
