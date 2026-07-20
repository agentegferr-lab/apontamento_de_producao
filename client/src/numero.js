/**
 * O Nomus manda quantidade em texto, no formato brasileiro: ponto como separador de
 * milhar, virgula como decimal (ex.: "1.287,64"). Number() nao entende isso direto.
 */
export function numeroBr(texto) {
  if (texto == null || texto === '') return 0
  const limpo = String(texto).trim().replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : 0
}

/** Caminho inverso: numero -> texto brasileiro, pra exibir totais somados. */
export function formatarNumeroBr(numero) {
  return numero.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

/** Texto cru do Nomus (ex. "1.805,61") -> "R$ 1.805,61" pra exibir. */
export function formatarMoedaBr(texto) {
  return numeroBr(texto).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}
