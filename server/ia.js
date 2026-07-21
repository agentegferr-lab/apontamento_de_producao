import { config } from './config.js'

/**
 * Sugestao de planejamento por IA — le um objetivo em texto livre (ex.: "planejar a
 * semana pra faturar R$50.000") e devolve quais ordens do backlog agendar em quais dias
 * pra atender esse objetivo. NUNCA agenda nada sozinha: so devolve uma sugestao pro
 * usuario revisar e aplicar manualmente (ver ModalSugestaoIA.jsx) — e uma IA, pode errar,
 * e isto afeta producao de verdade.
 *
 * Chama a API do Grok/xAI direto via fetch (sem SDK, seguindo o padrao do resto do
 * projeto — ver server/nomus.js). A API do Grok e compativel com o formato de "tool
 * calling" da OpenAI (endpoint /chat/completions, tools[].function, tool_choice) —
 * diferente do formato "tool use" da Anthropic. Forca a chamada da ferramenta pra
 * garantir uma resposta estruturada, em vez de tentar parsear texto livre da IA.
 */

const ENDPOINT = 'https://api.x.ai/v1/chat/completions'
const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/

const FERRAMENTA = {
  type: 'function',
  function: {
    name: 'propor_planejamento',
    description: 'Registra a sugestao de planejamento de producao para o periodo pedido.',
    parameters: {
      type: 'object',
      properties: {
        resumo: {
          type: 'string',
          description:
            'Explicacao curta (2-4 frases, em portugues) de como a sugestao atende o objetivo pedido — ' +
            'se o objetivo mencionar um valor de faturamento, cite o valor total das ordens escolhidas.',
        },
        sugestoes: {
          type: 'array',
          description: 'Ordens escolhidas do backlog fornecido, cada uma com o dia sugerido.',
          items: {
            type: 'object',
            properties: {
              idOperacaoOrdem: {
                type: 'integer',
                description: 'Exatamente igual ao idOperacaoOrdem de uma ordem da lista fornecida.',
              },
              data: { type: 'string', description: 'Data no formato AAAA-MM-DD, dentro do periodo pedido.' },
              motivo: { type: 'string', description: 'Motivo curto (menos de 15 palavras) dessa ordem entrar na sugestao.' },
            },
            required: ['idOperacaoOrdem', 'data'],
          },
        },
      },
      required: ['resumo', 'sugestoes'],
    },
  },
}

function montarPrompt({ objetivo, dataInicio, dataFim, backlog }) {
  const linhas = backlog.map(
    (o) =>
      `- idOperacaoOrdem=${o.idOperacaoOrdem} | ${o.nomeOrdem} | pedido ${o.pedido ?? '?'} | ` +
      `${o.produto ?? 'produto desconhecido'} | ${o.quantidade ?? '?'} ${o.unidadeMedida ?? ''} | valor ${o.valorTotal ?? 'desconhecido'}`,
  )

  return `Voce ajuda o PCP (planejamento e controle de producao) de uma metalurgica que fabrica telhas e acessorios metalicos.

Periodo a planejar: ${dataInicio} ate ${dataFim}.
Objetivo descrito pelo usuario (texto livre, em portugues, pode ser vago): "${objetivo}"

Ordens EM ESPERA que ainda nao comecaram nenhum processo (a UNICA fonte disponivel — escolha SOMENTE entre estas, pelo idOperacaoOrdem exato, nunca invente um id):
${linhas.join('\n')}

Regras:
- So pode sugerir idOperacaoOrdem que estejam na lista acima.
- Cada sugestao precisa de uma "data" dentro do periodo pedido (formato AAAA-MM-DD).
- Nao ha dado de capacidade diaria da fabrica disponivel — distribua de forma razoavel entre os dias do periodo, sem empilhar tudo num unico dia, a menos que o objetivo peca isso explicitamente.
- Se o objetivo mencionar um valor de faturamento, priorize as ordens que somadas cheguem mais perto do valor pedido, sem passar muito longe pra mais ou pra menos.
- Se o objetivo for vago ou nao mencionar faturamento, use bom senso (ex.: variedade de produtos, nao deixar nenhum dia vazio se der).

Chame a ferramenta propor_planejamento com sua sugestao.`
}

/**
 * Parte pura: nunca confia cegamente no que a IA devolveu. Descarta qualquer sugestao que
 * aponte pra um idOperacaoOrdem fora do backlog fornecido (alucinacao) ou uma data fora do
 * formato/periodo pedido — e so aqui, filtrado, que vira uma sugestao real pro usuario ver.
 * Separada da chamada de rede (sugerirPlanejamento) pra dar pra testar sem mockar a API.
 */
export function filtrarSugestoes(sugestoesBrutas, { backlog, dataInicio, dataFim }) {
  const porOperacao = new Map(backlog.map((o) => [Number(o.idOperacaoOrdem), o]))
  return (sugestoesBrutas ?? [])
    .filter((s) => {
      const ordem = porOperacao.get(Number(s.idOperacaoOrdem))
      const dataValida = REGEX_DATA.test(s.data ?? '') && s.data >= dataInicio && s.data <= dataFim
      return ordem && dataValida
    })
    .map((s) => ({
      ...porOperacao.get(Number(s.idOperacaoOrdem)),
      data: s.data,
      motivo: s.motivo ?? null,
    }))
}

export async function sugerirPlanejamento({ objetivo, dataInicio, dataFim, backlog }) {
  if (!config.iaApiKey) {
    throw new Error('IA_API_KEY nao configurada no servidor — defina no .env pra usar a sugestao por IA.')
  }

  const resposta = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.iaApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.iaModelo,
      messages: [{ role: 'user', content: montarPrompt({ objetivo, dataInicio, dataFim, backlog }) }],
      tools: [FERRAMENTA],
      tool_choice: { type: 'function', function: { name: 'propor_planejamento' } },
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!resposta.ok) {
    const corpo = await resposta.text()
    throw new Error(`API do Grok retornou ${resposta.status}: ${corpo.slice(0, 300)}`)
  }

  const dados = await resposta.json()
  const chamada = dados.choices?.[0]?.message?.tool_calls?.[0]
  if (!chamada?.function?.arguments) {
    throw new Error('A IA nao devolveu uma sugestao estruturada — tente de novo.')
  }

  let entrada
  try {
    // O formato OpenAI-compatible devolve os argumentos como STRING JSON, nao objeto —
    // diferente do "input" ja-objeto da Anthropic que este modulo usava antes.
    entrada = JSON.parse(chamada.function.arguments)
  } catch {
    throw new Error('A IA devolveu uma sugestao em formato invalido — tente de novo.')
  }

  return {
    resumo: entrada.resumo ?? '',
    sugestoes: filtrarSugestoes(entrada.sugestoes, { backlog, dataInicio, dataFim }),
  }
}
