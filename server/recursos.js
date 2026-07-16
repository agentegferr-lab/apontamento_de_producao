import { nomus } from './nomus.js'
import { nomeCentro } from './kanban.js'

/**
 * De qual recurso e o apontamento.
 *
 * O terminal e unico: um departamento de apontamento registra as ordens de TODOS os setores.
 * Entao o recurso nao pode ser fixo na maquina — precisa sair da propria operacao lida. Quem
 * digita e sempre a mesma pessoa; onde o trabalho aconteceu muda a cada leitura, e e isso
 * que o Nomus grava em idRecurso.
 *
 * Duas fontes, nessa ordem de preferencia:
 *
 * 1. `recursosPlanejados` da propria operacao: quando a operacao ja diz qual recurso foi
 *    planejado pra ela, usa esse — sem ambiguidade nenhuma, mesmo que o centro de trabalho
 *    tenha varias maquinas.
 * 2. Casamento pelo nome do centro de trabalho contra /recursos, como reserva pra quando
 *    recursosPlanejados vier vazio (ou o nome nao bater com nada). Um centro com varias
 *    maquinas cai na primeira ativa (ordenada por id, pra escolha ser sempre a mesma) e o
 *    log avisa.
 *
 * ATENCAO (confirmado contra o Nomus real em 2026-07-16, incidente do 406 em POST
 * /apontamentos com "Não foi possível encontrar um recurso com o id=2988"): o campo `id` de
 * `recursosPlanejados[]` NAO e o id de `/recursos` — sao numeracoes de tabelas diferentes
 * (ex.: "TR40 - Corte" e id 2988 no planejamento do roteiro, mas id 1 no catalogo real de
 * recursos). Postar um apontamento com o id bruto de recursosPlanejados e rejeitado. Por
 * isso o nome planejado e usado so pra CASAR contra /recursos pelo nome — o id que vai pro
 * Nomus e sempre o de /recursos, nunca o de recursosPlanejados.
 */

const avisados = new Set()

/**
 * Parte pura da preferencia por recursosPlanejados — sem rede, pra dar pra testar sem
 * mockar nada. Devolve null quando a lista vier vazia/sem id, e ai quem chama cai na
 * reserva (casamento por centro de trabalho).
 */
export function escolherRecursoPlanejado(recursosPlanejados) {
  const planejados = Array.isArray(recursosPlanejados) ? recursosPlanejados : []
  const valido = planejados.find((r) => r?.id != null)
  if (!valido) return null
  return { id: valido.id, nome: valido.nomeRecurso ?? `recurso ${valido.id}`, ambiguo: planejados.length > 1 }
}

/** Recursos ativos cujo centro de trabalho bate com o centro planejado da etapa. */
async function recursosDoCentro(centro) {
  const recursos = await nomus.recursos()
  const alvo = centro.trim().toLowerCase()
  return recursos
    .filter((r) => r.ativo !== false)
    .filter((r) => nomeCentro(r.centroTrabalho)?.trim().toLowerCase() === alvo)
    .sort((a, b) => Number(a.id) - Number(b.id))
}

export async function resolverRecursoDaOperacao(operacao) {
  const planejado = escolherRecursoPlanejado(operacao.recursosPlanejados)

  if (planejado) {
    // O id de recursosPlanejados nao serve pro POST /apontamentos (ver nota no topo do
    // arquivo) — usa o nome so pra achar o recurso de verdade em /recursos.
    const recursos = await nomus.recursos()
    const alvoNome = planejado.nome.trim().toLowerCase()
    const encontrado = recursos.find((r) => r.nome?.trim().toLowerCase() === alvoNome)

    if (encontrado) {
      if (planejado.ambiguo) {
        const chave = `planejados:${operacao.idOperacaoOrdem}`
        if (!avisados.has(chave)) {
          avisados.add(chave)
          console.warn(
            `[recursos] operacao ${operacao.idOperacaoOrdem} tem mais de um recurso planejado. ` +
              `Usando o primeiro: "${planejado.nome}".`,
          )
        }
      }
      return { id: encontrado.id, nome: encontrado.nome }
    }

    const chaveSemMatch = `sem-match:${operacao.idOperacaoOrdem}`
    if (!avisados.has(chaveSemMatch)) {
      avisados.add(chaveSemMatch)
      console.warn(
        `[recursos] recurso planejado "${planejado.nome}" (operacao ${operacao.idOperacaoOrdem}) ` +
          `nao foi encontrado em /recursos pelo nome. Caindo para o casamento por centro de trabalho.`,
      )
    }
    // Nao retorna: cai pra reserva abaixo, que tem sua propria logica de erro se tambem falhar.
  }

  // Reserva: a operacao nao trouxe recursosPlanejados (ou o nome nao bateu), casa pelo nome
  // do centro.
  const centro = nomeCentro(operacao.centroTrabalhoPlanejado)
  if (!centro) {
    const erro = new Error(
      `A etapa ${operacao.operacao} da ordem ${operacao.nomeOrdem} nao tem recursosPlanejados nem ` +
        `centro de trabalho planejado no Nomus — nao da pra saber em qual recurso apontar.`,
    )
    erro.status = 422
    throw erro
  }

  const candidatos = await recursosDoCentro(centro)
  if (candidatos.length === 0) {
    const erro = new Error(
      `Nenhum recurso ativo no centro de trabalho "${centro}" (etapa ${operacao.operacao} da ordem ${operacao.nomeOrdem}). Verifique o cadastro no Nomus.`,
    )
    erro.status = 422
    throw erro
  }

  if (candidatos.length > 1 && !avisados.has(centro)) {
    avisados.add(centro)
    console.warn(
      `[recursos] o centro "${centro}" tem ${candidatos.length} recursos ` +
        `(${candidatos.map((r) => r.nome).join(', ')}). Apontando sempre em "${candidatos[0].nome}".`,
    )
  }

  return candidatos[0]
}
