/**
 * Trava de quantidade: o que se aponta num processo nao pode passar da quantidade da ordem.
 *
 * Dois formatos diferentes do Nomus (confirmados em 2026-10-29 contra o Nomus real):
 *   - `qtdePlanejada` da operacao (em /operacoesRoteiroOrdem) vem em texto BRASILEIRO:
 *     "21", "15,6", "1,5428" (virgula decimal, ponto de milhar);
 *   - `quantidade` de um apontamento (em /apontamentos) vem com PONTO decimal: "21.000000".
 * Misturar os dois parsers erra por ordens de grandeza ("21.000000" lido como BR vira 21 milhoes).
 */

/** Texto brasileiro do Nomus ("1.287,64", "15,6", "21") -> numero; null se nao der pra ler. */
export function lerQuantidadeBr(valor) {
  if (valor == null || valor === '') return null
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  const n = Number(String(valor).trim().replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Soma o que ja foi apontado (campo `quantidade` dos apontamentos, ponto decimal). */
export function somarQuantidadeApontada(apontamentos) {
  const soma = (apontamentos ?? []).reduce((total, a) => {
    const n = Number(a?.quantidade)
    return Number.isFinite(n) ? total + n : total
  }, 0)
  return arredondar(soma)
}

const arredondar = (n) => Math.round(n * 10_000) / 10_000 // o Nomus guarda ate 4 casas

/**
 * @param quantidade     o que o operador quer apontar agora (numero)
 * @param qtdePlanejada  quantidade da ordem pra esta operacao (texto BR do Nomus)
 * @param jaApontada     soma do que ja foi gravado pra esta operacao
 * @returns { ok: true } ou { ok: false, maximo, restante } — sem `qtdePlanejada` legivel nao
 *          da pra validar: devolve ok (nao trava o operador por falta de dado).
 */
export function validarQuantidade({ quantidade, qtdePlanejada, jaApontada = 0 }) {
  const maximo = lerQuantidadeBr(qtdePlanejada)
  if (maximo == null || !(Number(quantidade) > 0)) return { ok: true }
  const restante = arredondar(maximo - jaApontada)
  if (arredondar(Number(quantidade)) > restante) {
    return { ok: false, maximo, restante: Math.max(0, restante) }
  }
  return { ok: true }
}

const fmt = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })

/** Mensagem mostrada ao operador quando a quantidade passa da ordem. */
export function mensagemQuantidadeAcima(operacao, quantidade, { maximo, restante }, jaApontada = 0) {
  return (
    `A quantidade informada (${fmt(Number(quantidade))}) é maior que a quantidade da ordem ${operacao.nomeOrdem} ` +
    `para este processo (${fmt(maximo)}${jaApontada > 0 ? `, já apontado ${fmt(jaApontada)}` : ''}). ` +
    `Informe no máximo ${fmt(restante)}.`
  )
}
