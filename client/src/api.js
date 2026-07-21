/** Toda chamada passa pelo proxy Express — a chave do Nomus nunca chega no browser. */

export class ApiError extends Error {
  constructor(mensagem, { status, codigo, retryAfterMs, idRecurso } = {}) {
    super(mensagem)
    this.name = 'ApiError'
    this.status = status
    this.codigo = codigo
    this.retryAfterMs = retryAfterMs
    // Acompanha ATIVIDADE_INDEFINIDA: e o que a tela usa pra montar o seletor de atividade
    // em vez de deixar o operador travado.
    this.idRecurso = idRecurso
  }
}

async function chamar(caminho, opcoes = {}) {
  let resposta
  try {
    resposta = await fetch(caminho, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', ...opcoes.headers },
    })
  } catch {
    throw new ApiError('Sem conexao com o servidor do terminal.', { status: 0 })
  }

  const texto = await resposta.text()
  let corpo = null
  try {
    corpo = texto ? JSON.parse(texto) : null
  } catch {
    corpo = texto
  }

  if (!resposta.ok) {
    throw new ApiError(corpo?.mensagem || `Erro ${resposta.status}`, {
      status: resposta.status,
      codigo: corpo?.codigo,
      retryAfterMs: corpo?.retryAfterMs,
      idRecurso: corpo?.idRecurso,
    })
  }
  return corpo
}

export const api = {
  terminal: () => chamar('/api/terminal'),
  atividades: (idRecurso) => chamar(`/api/atividades?idRecurso=${encodeURIComponent(idRecurso)}`),
  kanban: () => chamar('/api/kanban'),
  andamento: () => chamar('/api/andamento'),
  iniciar: (dados) => chamar('/api/iniciar', { method: 'POST', body: JSON.stringify(dados) }),
  pausar: (dados) => chamar('/api/pausar', { method: 'POST', body: JSON.stringify(dados) }),
  finalizar: (dados) => chamar('/api/finalizar', { method: 'POST', body: JSON.stringify(dados) }),
  motivosParada: (idOperacaoOrdem) =>
    chamar(`/api/motivos-parada?idOperacaoOrdem=${encodeURIComponent(idOperacaoOrdem)}`),
  resolverOperacao: (codigoOrdem, codigoProcesso) =>
    chamar('/api/resolver-operacao', {
      method: 'POST',
      body: JSON.stringify({ codigoOrdem, codigoProcesso }),
    }),
  planejamento: () => chamar('/api/planejamento'),
  agendar: (dados) => chamar('/api/planejamento', { method: 'POST', body: JSON.stringify(dados) }),
  moverPlanejado: (id, data) =>
    chamar(`/api/planejamento/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ data }) }),
  removerPlanejado: (id) => chamar(`/api/planejamento/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  sugerirPlanejamento: (dados) =>
    chamar('/api/planejamento/sugestao', { method: 'POST', body: JSON.stringify(dados) }),
}
