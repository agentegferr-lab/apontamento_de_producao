import { nomus } from './nomus.js'

/**
 * Resolucao do par de codigos de barras lidos no chao de fabrica.
 *
 * CONFIRMADO contra o Nomus real em 2026-07-15, com DUAS ordens fisicas diferentes
 * (comparando o numero impresso sob cada codigo de barras com o registro real da API,
 * via um projeto irmao que ja integra com o mesmo Nomus/mesma empresa):
 *
 *   codigo de barras da ORDEM     ==  campo `idOrdem`  de /operacoesRoteiroOrdem
 *   codigo de barras do PROCESSO  ==  campo `id`        de /operacoesRoteiroOrdem
 *
 * NAO e o numero de exibicao ("Op. 10") nem o nome da ordem ("OS 01444 - 001") — e o id
 * interno do registro dos dois lados. Isso e uma boa noticia: o `id` da operacao sozinho
 * ja identifica o registro sem ambiguidade nenhuma (e a chave primaria), entao a resolucao
 * vira uma busca direta, e o codigo da ordem serve so de conferencia (protege contra o
 * operador escanear duas etiquetas de ordens diferentes por engano).
 *
 * Suposicao anterior (que este arquivo tinha): o codigo da ordem batia com `nomeOrdem`
 * e o do processo com o campo de exibicao `operacao` (ex.: "10" = corte). Bateu num Nomus
 * de teste escrito por mim mesmo, mas nunca foi confirmada contra o Nomus real — e estava
 * errada.
 */

/** Tira espacos, zeros a esquerda e pontuacao de etiqueta ("(10)", "010", "10 " -> "10"). */
export function normalizarCodigo(valor) {
  if (valor === null || valor === undefined) return ''
  const limpo = String(valor)
    .trim()
    .toUpperCase()
    .replace(/[()\s.]/g, '')
  if (/^\d+$/.test(limpo)) return String(Number(limpo)) // "010" -> "10"
  return limpo
}

const igual = (a, b) => {
  const na = normalizarCodigo(a)
  const nb = normalizarCodigo(b)
  return na !== '' && na === nb
}

export class ResolucaoError extends Error {
  constructor(mensagem, codigo) {
    super(mensagem)
    this.name = 'ResolucaoError'
    this.status = 404
    this.codigo = codigo
  }
}

/**
 * Parte pura da resolucao — sem rede, so a lista ja carregada. Separada da busca pra dar
 * pra testar sem mockar nada.
 */
export function resolverNaLista(operacoes, codigoOrdem, codigoProcesso) {
  if (!normalizarCodigo(codigoOrdem)) {
    throw new ResolucaoError('Codigo da ordem vazio.', 'ORDEM_VAZIA')
  }
  if (!normalizarCodigo(codigoProcesso)) {
    throw new ResolucaoError('Codigo do processo vazio.', 'PROCESSO_VAZIO')
  }

  // O codigo do processo sozinho ja identifica o registro (id e chave primaria).
  const op = operacoes.find((o) => igual(o.id, codigoProcesso))

  if (!op) {
    throw new ResolucaoError(
      `Processo ${codigoProcesso} nao encontrado no Nomus. Confira se a etiqueta foi lida por inteiro.`,
      'PROCESSO_NAO_ENCONTRADO',
    )
  }

  // O codigo da ordem e conferencia, nao busca: protege contra escanear a ordem de uma
  // etiqueta e o processo de outra por engano.
  if (!igual(op.idOrdem, codigoOrdem)) {
    throw new ResolucaoError(
      `O processo ${codigoProcesso} pertence a outra ordem (nao a ${codigoOrdem}). Confira se as duas etiquetas lidas sao da mesma OS.`,
      'ORDEM_PROCESSO_NAO_CORRESPONDEM',
    )
  }

  return {
    idOperacaoOrdem: op.id,
    idOrdem: op.idOrdem,
    nomeOrdem: op.nomeOrdem,
    descricao: op.descricao,
    operacao: op.operacao,
    centroTrabalhoPlanejado: op.centroTrabalhoPlanejado,
    // Confirmado contra o Nomus real: a propria operacao pode listar o(s) recurso(s)
    // planejados pra ela. Ver server/recursos.js — e a fonte preferida do idRecurso.
    recursosPlanejados: op.recursosPlanejados,
  }
}

export async function resolverOperacao(codigoOrdem, codigoProcesso) {
  const operacoes = await nomus.todasOperacoes()
  return resolverNaLista(operacoes, codigoOrdem, codigoProcesso)
}
