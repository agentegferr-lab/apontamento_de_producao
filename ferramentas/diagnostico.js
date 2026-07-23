/**
 * Confere, contra o Nomus REAL, que a integracao esta funcionando de ponta a ponta.
 *
 * Por que existe: todo o desenvolvimento foi validado contra mock/nomus-fake.js, que fui EU
 * que escrevi. Ele testa a logica do app, mas nao as suposicoes — devolve exatamente o que
 * presumi que a API devolve, entao nunca me contradiz. Este script contradiz.
 *
 * CONFIRMADO em 2026-07-15 (comparando com um projeto irmao que ja integra com o mesmo
 * Nomus ha dias):
 *   - Listas paginam em SILENCIO, sempre 50 por pagina, via `?pagina=N` (1-indexado). Um
 *     GET sem esse parametro so traz a pagina 1 — por isso as secoes abaixo paginam ate o
 *     fim, exatamente como server/nomus.js faz.
 *   - O codigo de barras da ORDEM e o campo `idOrdem`; o do PROCESSO e o campo `id` — nao
 *     sao os numeros de exibicao ("Op. 10", "OS 01444 - 001").
 *   - O pedido nao e um campo direto: e /ordens[].itensPedido[0].idPedido cruzado com
 *     /pedidos/{id} (que aceita busca por id; a listagem completa de /pedidos tem milhares
 *     de registros e NAO deve ser buscada por inteiro).
 *
 *   node ferramentas/diagnostico.js                 # confere a API inteira
 *   node ferramentas/diagnostico.js 1504 2739       # + resolve uma etiqueta real (idOrdem/id)
 *
 * SO FAZ GET. Nao cria, nao altera e nao apaga nada no ERP.
 */
import { config, validarConfig } from '../server/config.js'
import { resolverNaLista } from '../server/resolver.js'

try {
  validarConfig()
} catch (erro) {
  console.error(erro.message)
  process.exit(1)
}

const [codigoOrdem, codigoProcesso] = process.argv.slice(2)

const ok = (t) => console.log(`  \x1b[32mOK\x1b[0m    ${t}`)
const alerta = (t) => console.log(`  \x1b[33mAVISO\x1b[0m ${t}`)
const falha = (t) => console.log(`  \x1b[31mFALHA\x1b[0m ${t}`)
const titulo = (t) => console.log(`\n\x1b[1m${t}\x1b[0m\n${'-'.repeat(t.length)}`)

const problemas = []
const registrar = (t) => {
  problemas.push(t)
  falha(t)
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Repete em 429 (mesma heuristica de server/nomus.js pro campo tempoAteLiberar). Sem isto,
 * uma sequencia de chamadas (como a secao 6, uma por recurso) pode ser throttled no meio, e
 * quem chama receberia o corpo do erro 429 como se fosse um corpo de sucesso vazio —
 * "nenhuma atividade" quando na verdade a chamada nem chegou a ser respondida de verdade.
 */
async function get(caminho, query, tentativas = 3) {
  const url = new URL(config.baseUrl + caminho)
  for (const [k, v] of Object.entries(query ?? {})) if (v != null) url.searchParams.set(k, String(v))

  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Basic ${config.credencialBasic}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      const texto = await r.text()
      let corpo = null
      try {
        corpo = texto ? JSON.parse(texto) : null
      } catch {
        corpo = texto.slice(0, 300)
      }

      if (r.status === 429 && tentativa <= tentativas) {
        const bruto = Number(corpo?.tempoAteLiberar)
        const esperaMs = Number.isFinite(bruto) && bruto > 0 ? (bruto <= 300 ? bruto * 1000 : bruto) : 3000
        console.log(`      (429 em ${caminho} — aguardando ${esperaMs}ms antes de tentar de novo)`)
        await dormir(esperaMs)
        continue
      }
      return { status: r.status, corpo }
    } catch (e) {
      return { status: 0, erro: e.message }
    }
  }
}

const lista = (v) => (Array.isArray(v) ? v : (v?.content ?? v?.lista ?? v?.dados ?? []))
const nomeCentro = (c) => (typeof c === 'string' ? c.trim() : (c?.nome?.trim() ?? null))
const norm = (v) => String(v ?? '').trim().toLowerCase()
const mostrar = (v, largura = 60) => {
  const s = JSON.stringify(v)
  return s == null ? 'null' : s.length > largura ? s.slice(0, largura) + '…' : s
}
const mostrarCompleto = (v) => JSON.stringify(v, null, 2).split('\n').join('\n    ')

/**
 * Pagina ate o fim, igual server/nomus.js: `?pagina=N` comecando em 1, ate uma pagina vir
 * mais curta que 50. `maxPaginas` e so uma trava de seguranca contra um servidor com bug
 * que nunca devolva pagina curta — nao um limite de negocio.
 */
async function getPaginado(caminho, query, { maxPaginas = 300, avisarProgresso = false } = {}) {
  const itens = []
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    if (pagina > 1) await dormir(300)
    const { status, corpo, erro } = await get(caminho, { ...query, pagina })
    if (status !== 200) return { status, erro, itens }
    const pagina_ = lista(corpo)
    itens.push(...pagina_)
    if (avisarProgresso && pagina % 5 === 0) console.log(`      ... pagina ${pagina}, ${itens.length} registros ate aqui`)
    if (pagina_.length < 50) return { status: 200, itens }
  }
  return { status: 200, itens, estourouLimite: true }
}

console.log(`\nNomus: ${config.baseUrl}`)
console.log(`Matricula de teste (NOMUS_MATRICULA, opcional): ${config.matriculaFallback ?? '(nao definida)'}`)

if (config.baseUrl.includes('localhost')) {
  alerta('NOMUS_BASE_URL aponta para localhost — isto e o mock, nao o ERP real.')
}

// --- 1. Autenticacao -----------------------------------------------------------------
titulo('1. Chave de integracao')
{
  const { status, erro } = await get('/recursos')
  if (status === 0) registrar(`Sem resposta do Nomus: ${erro}`)
  else if (status === 401 || status === 403) registrar(`Chave recusada (HTTP ${status}). Confira NOMUS_API_KEY.`)
  else if (status === 200) ok('A chave foi aceita.')
  else registrar(`Resposta inesperada em /recursos: HTTP ${status}`)
}
if (problemas.length) {
  console.log('\nSem passar daqui nao da pra conferir o resto. Corrija e rode de novo.\n')
  process.exit(1)
}

// --- 2. Funcionario de teste (NOMUS_MATRICULA) ----------------------------------------
// Desde a intranet com login, cada operador tem a propria matricula_nomus cadastrada (ver
// server/usuarios.js) — nao existe mais "o" funcionario fixo do terminal. NOMUS_MATRICULA
// e so um valor de conveniencia pra testar esta ferramenta contra o mock/uma matricula
// conhecida; sem ela, este passo e so pulado.
titulo('2. Funcionario de teste (NOMUS_MATRICULA, opcional)')
let funcionario = null
if (!config.matriculaFallback) {
  console.log('  NOMUS_MATRICULA nao definida — pulando (cada operador agora usa a propria matricula cadastrada na intranet).')
} else {
  const { corpo } = await get('/funcionarios', { matricula: config.matriculaFallback })
  const todos = lista(corpo)
  funcionario = todos.find((f) => String(f.matricula) === String(config.matriculaFallback))

  if (!funcionario) {
    registrar(`Nenhum funcionario com a matricula ${config.matriculaFallback}.`)
  } else {
    ok(`${funcionario.nome} (id ${funcionario.id})`)
    if (funcionario.ativo === false) registrar(`${funcionario.nome} esta INATIVO no Nomus.`)
    const limite = Number(funcionario.limiteApontamentosSimultaneos)
    if (Number.isFinite(limite) && limite > 0) ok(`Limite de apontamentos simultaneos: ${limite}`)
    else alerta('Sem limiteApontamentosSimultaneos definido — o app usa LIMITE_APONTAMENTOS_FALLBACK.')
    if (todos.length > 1) {
      alerta(`O filtro ?matricula= devolveu ${todos.length} registros — o Nomus parece ignora-lo (o app filtra de novo, entao segue funcionando).`)
    }
  }
}

// --- 3. Recursos e centros de trabalho -----------------------------------------------
titulo('3. Recursos e centros de trabalho')
let recursos = []
{
  const { corpo } = await get('/recursos')
  recursos = lista(corpo).filter((r) => r.ativo !== false)
  ok(`${recursos.length} recurso(s) ativo(s).`)

  const semCentro = recursos.filter((r) => !nomeCentro(r.centroTrabalho))
  if (semCentro.length) {
    registrar(
      `${semCentro.length} recurso(s) sem centroTrabalho (${semCentro.slice(0, 3).map((r) => r.nome).join(', ')}). ` +
        'O app descobre o recurso pelo centro de trabalho da etapa — sem isso, nao aponta neles.',
    )
  }

  const porCentro = new Map()
  for (const r of recursos) {
    const c = nomeCentro(r.centroTrabalho)
    if (c) porCentro.set(c, [...(porCentro.get(c) ?? []), r.nome])
  }
  for (const [centro, maquinas] of porCentro) {
    if (maquinas.length > 1) {
      alerta(`Centro "${centro}" tem ${maquinas.length} recursos (${maquinas.join(', ')}) — o app aponta sempre no primeiro.`)
    }
  }
}

// --- 4. Roteiro: e a base do kanban e da leitura de etiqueta -------------------------
titulo('4. Operacoes do roteiro (/operacoesRoteiroOrdem), paginado ate o fim')
let operacoes = []
{
  const t0 = Date.now()
  console.log('  Isto pagina ate o fim (dezenas de chamadas se a base for grande) — pode demorar.')
  const { status, itens, erro, estourouLimite } = await getPaginado('/operacoesRoteiroOrdem', {}, { avisarProgresso: true })
  const ms = Date.now() - t0
  operacoes = itens

  if (status !== 200) {
    registrar(`HTTP ${status}${erro ? ` (${erro})` : ''} — sem este endpoint o app nao resolve etiqueta nenhuma.`)
  } else {
    ok(`${operacoes.length} operacao(oes) no total, em ${ms}ms (${Math.ceil(operacoes.length / 50)} pagina(s)).`)
    if (estourouLimite) alerta('Bateu no limite de seguranca de paginas — pode haver mais operacoes do que as lidas aqui.')
    if (ms > 30_000) {
      alerta(`Uma varredura completa levou ${Math.round(ms / 1000)}s. O cache (CACHE_TTL_MS, hoje ${config.cacheTtlMs / 1000}s) evita repetir isso toda hora — nao baixe demais.`)
    }

    const amostra = operacoes[0]
    if (amostra) {
      console.log(`\n  Campos do primeiro registro:`)
      for (const [k, v] of Object.entries(amostra)) {
        if (k === 'recursosPlanejados') continue // mostrado inteiro abaixo
        console.log(`    ${k.padEnd(34)} = ${mostrar(v)}`)
      }
      for (const campo of ['id', 'idOrdem', 'nomeOrdem', 'operacao', 'centroTrabalhoPlanejado']) {
        if (!(campo in amostra)) registrar(`Campo "${campo}" NAO existe na resposta — o app depende dele.`)
      }

      // A operacao pode listar os recursos planejados dela mesma — quando presente, e a
      // fonte preferida do idRecurso (ver server/recursos.js), sem ambiguidade de centro.
      if (Array.isArray(amostra.recursosPlanejados)) {
        console.log(`\n  recursosPlanejados (primeiro registro):`)
        console.log(`    ${mostrarCompleto(amostra.recursosPlanejados)}`)
      }
    }

    const idsRepetidos = operacoes.length - new Set(operacoes.map((o) => o.id)).size
    if (idsRepetidos > 0) {
      registrar(`${idsRepetidos} operacao(oes) com "id" repetido entre as paginas — a paginacao pode estar instavel (paginas mudando enquanto le).`)
    }
  }
}

// --- 5. O cruzamento que faz o idRecurso existir --------------------------------------
titulo('5. Centro da etapa x centro do recurso (define o idRecurso)')
{
  const centrosRecurso = new Set(recursos.map((r) => norm(nomeCentro(r.centroTrabalho))).filter(Boolean))
  const centrosEtapa = new Set(operacoes.map((o) => norm(nomeCentro(o.centroTrabalhoPlanejado))).filter(Boolean))

  const semEtapa = operacoes.filter((o) => !nomeCentro(o.centroTrabalhoPlanejado)).length
  if (semEtapa) alerta(`${semEtapa} etapa(s) sem centroTrabalhoPlanejado — nao da pra apontar nelas.`)

  const orfaos = [...centrosEtapa].filter((c) => !centrosRecurso.has(c))
  if (orfaos.length === 0 && centrosEtapa.size > 0) {
    ok(`Todos os ${centrosEtapa.size} centros das etapas tem recurso correspondente.`)
  } else if (orfaos.length) {
    registrar(
      `${orfaos.length} centro(s) das etapas SEM recurso com o mesmo nome: ${orfaos.slice(0, 5).join(', ')}. ` +
        'O app casa esses nomes por texto — sem correspondencia, o Iniciar falha nessas etapas.',
    )
    console.log(`    centros nos recursos: ${[...centrosRecurso].join(', ')}`)
  }
}

// --- 6. Atividades e motivos de parada ------------------------------------------------
titulo('6. Atividades (producao e paradas)')
{
  // A base e pequena (dezenas de recursos): confere todos, nao so uma amostra —
  // os primeiros da lista podem ser todos do mesmo centro e esconder um problema noutro.
  const alvos = recursos
  for (const [i, r] of alvos.entries()) {
    // Um respiro entre chamadas: foi uma sequencia rapida de 16 chamadas iguais a esta que
    // provocou o 429 que gerou o alarme falso original.
    if (i > 0) await dormir(250)
    const { corpo, status } = await get('/atividades', { idRecurso: r.id })

    // Nao confunde "a chamada falhou" com "o recurso nao tem atividade": sao diagnosticos
    // bem diferentes, e tratar os dois igual foi exatamente o bug que deu um alarme falso
    // na primeira versao deste script.
    if (status !== 200) {
      alerta(`Recurso "${r.nome}": nao consegui confirmar as atividades (HTTP ${status}), nao "zero atividades". Tente de novo.`)
      continue
    }

    const brutas = lista(corpo)
    const ats = brutas.filter((a) => a.ativo !== false)

    if (ats.length === 0) {
      if (brutas.length > 0) {
        // Existem, so estao inativas — e um ajuste de cadastro no Nomus (ativar), nao um
        // bug de codigo. Bem diferente de "nao existe nenhuma atividade pra este recurso".
        registrar(
          `Recurso "${r.nome}": ${brutas.length} atividade(s) cadastrada(s), mas TODAS inativas ` +
            `(${brutas.map((a) => a.nome).join(', ')}). Ative pelo menos uma no Nomus.`,
        )
      } else {
        registrar(`Recurso "${r.nome}" nao tem NENHUMA atividade cadastrada — precisa criar no Nomus antes de apontar nele.`)
      }
      continue
    }
    const paradas = ats.filter((a) => !a.aptQtdProduzida && !a.aptPercentualProdAndamento)
    const producao = ats.filter((a) => a.aptQtdProduzida || a.aptPercentualProdAndamento)

    console.log(`\n  ${r.nome}: ${ats.map((a) => a.nome).join(', ')}`)
    if (producao.length === 0) alerta(`  Nenhuma atividade pede quantidade — confira se e o esperado.`)
    if (paradas.length === 0) {
      registrar(`  Sem atividades de parada. O botao Pausar nao tera motivo nenhum a oferecer.`)
    } else {
      ok(`  Motivos de parada que o app vai oferecer: ${paradas.map((a) => a.nome).join(', ')}`)
    }
    if (config.atividadePadrao && !ats.some((a) => norm(a.nome) === norm(config.atividadePadrao))) {
      alerta(`  NOMUS_ATIVIDADE_PADRAO="${config.atividadePadrao}" nao existe aqui — a tela vai perguntar.`)
    }
  }
  if (recursos.length > alvos.length) console.log(`\n  (conferi os primeiros ${alvos.length} de ${recursos.length} recursos)`)
}

// --- 7. Apontamentos ------------------------------------------------------------------
titulo('7. Apontamentos ja gravados (definem etapa concluida), paginado ate o fim')
let apontamentos = []
{
  const t0 = Date.now()
  const { status, itens, erro, estourouLimite } = await getPaginado('/apontamentos', {}, { avisarProgresso: true })
  const ms = Date.now() - t0
  apontamentos = itens

  if (status !== 200) registrar(`HTTP ${status}${erro ? ` (${erro})` : ''} — o kanban nao sabe o que ja foi concluido.`)
  else {
    ok(`${apontamentos.length} apontamento(s) no total, em ${ms}ms.`)
    if (estourouLimite) alerta('Bateu no limite de seguranca de paginas — pode haver mais apontamentos do que os lidos aqui.')
    if (apontamentos[0]) {
      const campos = Object.keys(apontamentos[0])
      for (const c of ['idOperacaoOrdem', 'dataHoraInicial', 'dataHoraFinal']) {
        if (!campos.includes(c)) registrar(`Apontamento sem o campo "${c}" — o kanban depende dele.`)
      }
      console.log(`    exemplo: ${JSON.stringify(apontamentos[0]).slice(0, 160)}`)
      if (/^\d{2}\/\d{2}\/\d{4}/.test(String(apontamentos[0].dataHoraInicial))) {
        alerta(
          'A data vem em DD/MM/YYYY, mas o app manda ISO (YYYY-MM-DDTHH:mm:ss) no POST. ' +
            'Nao confirmado se o POST aceita o mesmo formato do GET — ver README, secao de risco de data.',
        )
      }
    }
  }
}

// --- 8. Numero do pedido --------------------------------------------------------------
titulo('8. Numero do pedido nos cards (/ordens + /pedidos/{id})')
{
  const { status: stOrdens, itens: ordens, erro: erroOrdens } = await getPaginado('/ordens', {}, { avisarProgresso: true })
  if (stOrdens !== 200) {
    registrar(`GET /ordens -> HTTP ${stOrdens}${erroOrdens ? ` (${erroOrdens})` : ''} — os cards ficam so com a OS.`)
  } else {
    ok(`/ordens existe (${ordens.length} registro(s)).`)
    const comItem = ordens.find((o) => o?.itensPedido?.[0]?.idPedido != null)
    if (!comItem) {
      alerta('Nenhuma ordem tem itensPedido[0].idPedido — confira se o formato mudou.')
    } else {
      const item = comItem.itensPedido[0]
      console.log(`    itensPedido[0] de exemplo: ${mostrar(item, 120)}`)

      // NUNCA listar /pedidos inteiro (milhares de registros, fortemente limitado por rate
      // limit) — so confirma que a busca por UM id especifico funciona.
      const { status: stPedido, corpo: pedido } = await get(`/pedidos/${item.idPedido}`)
      if (stPedido === 200 && pedido && !Array.isArray(pedido)) {
        ok(`GET /pedidos/${item.idPedido} resolve direto (sem precisar listar /pedidos inteiro).`)
        console.log(`    campos: ${Object.keys(pedido).join(', ')}`)
        console.log(`    exemplo: ${mostrar(pedido, 150)}`)
        if (!('codigoPedido' in pedido)) {
          alerta(`Campo "codigoPedido" nao existe neste pedido — ajuste NOMUS_CAMPO_PEDIDO. Campos disponiveis acima.`)
        }
      } else {
        registrar(`GET /pedidos/${item.idPedido} -> HTTP ${stPedido}. Sem isto os cards ficam sem numero de pedido.`)
      }
    }
  }
}

// --- 9. Teste de uma etiqueta real ----------------------------------------------------
if (codigoOrdem && codigoProcesso) {
  titulo(`9. Etiqueta real: codigo da ordem "${codigoOrdem}" (idOrdem) + codigo do processo "${codigoProcesso}" (id)`)
  console.log('  Resolvendo pela formula confirmada: codigo da ordem == idOrdem, codigo do processo == id.\n')

  try {
    const op = resolverNaLista(operacoes, codigoOrdem, codigoProcesso)
    ok(`Resolveu: OS ${op.nomeOrdem} · etapa ${op.operacao} · ${op.descricao}`)
    console.log(`  idOperacaoOrdem = ${op.idOperacaoOrdem} (e isto que vai no apontamento)`)

    if (Array.isArray(op.recursosPlanejados) && op.recursosPlanejados[0]?.id != null) {
      ok(`Recurso vem de recursosPlanejados: "${op.recursosPlanejados[0].nomeRecurso}" (id ${op.recursosPlanejados[0].id}).`)
    } else {
      const centro = nomeCentro(op.centroTrabalhoPlanejado)
      const recurso = recursos.find((r) => norm(nomeCentro(r.centroTrabalho)) === norm(centro))
      if (recurso) ok(`Sem recursosPlanejados; resolve pelo centro "${centro}" -> recurso "${recurso.nome}".`)
      else registrar(`Centro "${centro}" nao tem recurso correspondente — o Iniciar vai falhar nesta etapa.`)
    }
  } catch (erro) {
    registrar(`Nao resolveu: ${erro.message} (codigo: ${erro.codigo ?? 'desconhecido'})`)
    if (erro.codigo === 'PROCESSO_NAO_ENCONTRADO') {
      console.log(
        '    Se a ordem for antiga, confira se a secao 4 acima leu TODAS as paginas (nao so a 1a) —\n' +
          '    o "id" procurado pode estar numa pagina que nao foi lida se bateu o limite de seguranca.',
      )
    }
  }
} else {
  titulo('9. Etiqueta real')
  console.log('  Pulado. Rode com os DOIS numeros impressos sob os codigos de barra de uma OS real:')
  console.log('    node ferramentas/diagnostico.js 1504 2739')
}

// --- Resumo ---------------------------------------------------------------------------
titulo('Resumo')
if (problemas.length === 0) {
  console.log('  Nenhum impedimento encontrado. Ainda assim, o primeiro apontamento de verdade')
  console.log('  deve ser numa ordem de teste — o POST /apontamentos nunca foi exercitado aqui.')
} else {
  console.log(`  ${problemas.length} problema(s) que impedem o funcionamento:\n`)
  problemas.forEach((p, i) => console.log(`   ${i + 1}. ${p}`))
}
console.log('')
