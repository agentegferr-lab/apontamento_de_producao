import 'dotenv/config'

/**
 * Os campos obrigatorios sao getters, nao valores. Importar este modulo nunca falha —
 * quem quiser um segredo ausente e que recebe o erro. Isso mantem os testes das funcoes
 * puras rodando sem .env, e o boot chama validarConfig() pra falhar rapido de verdade.
 */

function obrigatorio(nome) {
  const valor = process.env[nome]
  if (!valor || !valor.trim()) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${nome}. Copie .env.example para .env e preencha.`,
    )
  }
  return valor.trim()
}

function num(nome, padrao) {
  const bruto = process.env[nome]
  if (bruto === undefined || bruto === '') return padrao
  const n = Number(bruto)
  if (!Number.isFinite(n)) throw new Error(`Variavel ${nome} deve ser numerica, recebido: ${bruto}`)
  return n
}

export const config = {
  get porta() {
    return num('PORT', 3000)
  },

  get baseUrl() {
    const url = process.env.NOMUS_BASE_URL?.trim() || 'https://constelha.nomus.com.br/constelha/rest'
    return url.replace(/\/+$/, '')
  },

  /**
   * A chave do Nomus (Configuracao Geral -> "Chave de acesso para integracao com o ERP via
   * REST") ja vem em Base64 e vai direto como credencial do Basic. NOMUS_USUARIO_SENHA e a
   * alternativa pra quem tem usuario:senha em texto.
   */
  get credencialBasic() {
    const chave = process.env.NOMUS_API_KEY?.trim()
    if (chave) return chave

    const usuarioSenha = process.env.NOMUS_USUARIO_SENHA?.trim()
    if (usuarioSenha) return Buffer.from(usuarioSenha, 'utf8').toString('base64')

    throw new Error(
      'Defina NOMUS_API_KEY (chave Base64 do Nomus) ou NOMUS_USUARIO_SENHA (formato usuario:senha).',
    )
  },

  /**
   * So usado como fallback em dev/mock (ver server/index.js) quando o operador logado nao
   * tem matricula_nomus cadastrada ainda. Em producao cada operador tem a propria matricula
   * no cadastro de usuario da intranet (ver server/usuarios.js) — nao existe mais "o"
   * funcionario fixo do terminal.
   */
  get matriculaFallback() {
    return process.env.NOMUS_MATRICULA?.trim() || null
  },

  // --- Intranet (login) ---------------------------------------------------------------
  get sessionSecret() {
    return obrigatorio('SESSION_SECRET')
  },
  // Duracao da sessao — padrao cobre um turno de 12h sem pedir login de novo no meio.
  get sessaoDuracaoHoras() {
    return num('SESSAO_DURACAO_HORAS', 12)
  },
  get adminEmailInicial() {
    return process.env.ADMIN_EMAIL_INICIAL?.trim() || null
  },
  get adminSenhaInicial() {
    return process.env.ADMIN_SENHA_INICIAL?.trim() || null
  },

  /**
   * Atividade padrao POR NOME (ex.: "Producao"). O terminal aponta todos os setores, e cada
   * recurso tem sua propria atividade "Producao" com id diferente — casar por nome e o unico
   * jeito de um padrao valer pra fabrica inteira. Se o nome nao existir no recurso da vez, a
   * tela pergunta.
   */
  get atividadePadrao() {
    return process.env.NOMUS_ATIVIDADE_PADRAO?.trim() || null
  },

  /**
   * Quais atividades podem ser motivo de parada (nomes separados por virgula, ex.:
   * "Refeicao,Banheiro,Quebra de maquina"). A API nao tem flag que diga "isto e parada".
   * Vazio = qualquer atividade do recurso que nao seja a de producao em curso.
   */
  get atividadesParada() {
    const bruto = process.env.NOMUS_ATIVIDADES_PARADA?.trim()
    if (!bruto) return null
    const nomes = bruto
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean)
    return nomes.length ? nomes : null
  },

  // Usado apenas se o funcionario nao tiver limiteApontamentosSimultaneos definido no Nomus.
  get limiteFallback() {
    return num('LIMITE_APONTAMENTOS_FALLBACK', 0)
  },

  /**
   * TTL do cache de operacoes/apontamentos/ordens (paginados por inteiro). 3 minutos e o
   * mesmo valor validado por um projeto irmao rodando contra este mesmo Nomus ha dias —
   * uma varredura completa custa dezenas de paginas, entao um TTL curto refaria esse custo
   * a cada poucos segundos sem necessidade.
   */
  get cacheTtlMs() {
    return num('CACHE_TTL_MS', 180_000)
  },
  get timeoutMs() {
    return num('NOMUS_TIMEOUT_MS', 20_000)
  },

  // Teto de espera por retry de 429. Acima disso o erro sobe pro cliente com o retryAfter.
  get maxEsperaThrottleMs() {
    return num('MAX_ESPERA_THROTTLE_MS', 30_000)
  },
  get maxTentativasThrottle() {
    return num('MAX_TENTATIVAS_THROTTLE', 3)
  },

  /**
   * Opcional (nao entra em validarConfig) — o app inteiro funciona sem isto, so a sugestao
   * de planejamento por IA (ver server/ia.js) fica indisponivel, com um erro claro, ate ser
   * preenchida. Nome generico (nao "XAI_*"/"ANTHROPIC_*") de proposito: hoje aponta pra API
   * do Grok/xAI (compativel com o formato OpenAI de tool calling), mas trocar de provedor
   * no futuro e so reescrever server/ia.js, sem precisar renomear a variavel de novo.
   */
  get iaApiKey() {
    return process.env.IA_API_KEY?.trim() || null
  },
  get iaModelo() {
    return process.env.IA_MODELO?.trim() || 'grok-4'
  },
}

/** Chamado no boot: toca em todo campo obrigatorio pra derrubar o processo agora, nao na 1a leitura de codigo. */
export function validarConfig() {
  const campos = ['porta', 'baseUrl', 'credencialBasic', 'sessionSecret', 'cacheTtlMs', 'timeoutMs']
  const problemas = []
  for (const campo of campos) {
    try {
      config[campo]
    } catch (erro) {
      problemas.push(erro.message)
    }
  }
  if (problemas.length) {
    throw new Error(`Configuracao invalida:\n  - ${problemas.join('\n  - ')}`)
  }
}
