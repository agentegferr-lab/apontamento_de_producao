/**
 * Trava de duplicidade: cada processo (etapa) de uma ordem so pode ser apontado UMA vez.
 *
 * Um apontamento ja gravado no Nomus pra aquela operacao (`idOperacaoOrdem`) significa que o
 * processo ja foi feito — bipar a mesma ordem + etapa de novo seria produzir/contar duas
 * vezes. Retomar um processo PAUSADO nao passa por aqui: ele ainda esta aberto no terminal e
 * so grava no Nomus quando for finalizado (ver server/index.js, /api/iniciar).
 */

/** Apontamentos da lista que pertencem a `idOperacaoOrdem` (filtra aqui mesmo: nao depende do Nomus honrar o `query`). */
export function apontamentosDaOperacao(lista, idOperacaoOrdem) {
  const alvo = Number(idOperacaoOrdem)
  return (lista ?? []).filter((a) => Number(a?.idOperacaoOrdem) === alvo)
}

/** Mensagem mostrada ao operador quando a etapa ja foi apontada. */
export function mensagemProcessoJaApontado(operacao, apontamentos = []) {
  const ultimo = [...apontamentos].map((a) => a?.dataHoraFinal).filter(Boolean).at(0)
  const etapa = [operacao.operacao, operacao.descricao].filter((x) => x != null && x !== '').join(' - ')
  return (
    `A ordem ${operacao.nomeOrdem} já foi apontada para o processo ${etapa || operacao.operacao}` +
    (ultimo ? ` (em ${ultimo})` : '') +
    '. Cada processo só pode ser apontado uma vez.'
  )
}
