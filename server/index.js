import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, validarConfig } from './config.js'
import { nomus, NomusError } from './nomus.js'
import { resolverOperacao, ResolucaoError } from './resolver.js'
import { andamento, PRODUZINDO, PAUSADO } from './andamento.js'
import { montarKanban } from './kanban.js'
import { resolverRecursoDaOperacao } from './recursos.js'
import { mapaPedidosPorOrdem } from './pedidos.js'
import { planejamento, REGEX_DATA } from './planejamento.js'

try {
  validarConfig()
} catch (erro) {
  console.error(erro.message)
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '256kb' }))

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

class AppError extends Error {
  constructor(mensagem, status = 400, codigo) {
    super(mensagem)
    this.status = status
    this.codigo = codigo
  }
}

/** O funcionario do terminal vem da matricula em .env — nunca do cliente. */
async function funcionarioDoTerminal() {
  const funcionario = await nomus.funcionarioPorMatricula(config.matricula)
  if (!funcionario) {
    throw new NomusError(`Nenhum funcionario com a matricula ${config.matricula} no Nomus.`, {
      status: 500,
    })
  }
  if (funcionario.ativo === false) {
    throw new NomusError(`O funcionario ${funcionario.nome} esta inativo no Nomus.`, { status: 500 })
  }
  return funcionario
}

/**
 * Atividade do apontamento — sempre dentro do recurso ja resolvido.
 *
 * Como o terminal aponta todos os setores, um id fixo em .env valeria so pra um recurso
 * (atividade pertence a um recurso). Por isso o padrao casa por NOME: "Producao" existe em
 * varios recursos com ids diferentes, e e isso que um terminal unico precisa.
 */
async function resolverAtividade(idRecurso, idAtividadePedida) {
  const atividades = (await nomus.atividades(idRecurso)).filter((a) => a.ativo !== false)

  if (atividades.length === 0) {
    throw new AppError(
      `O recurso ${idRecurso} nao tem nenhuma atividade ativa no Nomus. Cadastre uma antes de apontar.`,
      500,
    )
  }

  if (idAtividadePedida) {
    const escolhida = atividades.find((a) => Number(a.id) === Number(idAtividadePedida))
    if (!escolhida) throw new AppError(`Atividade ${idAtividadePedida} nao existe neste recurso.`)
    return escolhida
  }

  if (config.atividadePadrao) {
    const alvo = config.atividadePadrao.trim().toLowerCase()
    const padrao = atividades.find((a) => a.nome?.trim().toLowerCase() === alvo)
    // Nao achou neste recurso: cai pros criterios abaixo em vez de travar o apontamento.
    if (padrao) return padrao
  }

  if (atividades.length === 1) return atividades[0]

  // A tela trata este codigo abrindo o seletor de atividade — nao e um beco sem saida.
  // Vai junto o idRecurso: o terminal nao o escolhe mais, entao so o servidor sabe qual e.
  const erro = new AppError(
    `Esta estação tem ${atividades.length} atividades. Escolha qual será apontada.`,
    409,
    'ATIVIDADE_INDEFINIDA',
  )
  erro.idRecurso = idRecurso
  throw erro
}

/**
 * Hora local "YYYY-MM-DDTHH:mm:ss" — formato interno do app (segmentos, cronometro,
 * comparacoes). NAO e o que o Nomus aceita no POST — ver paraFormatoNomus() abaixo.
 * Usado internamente porque ordena certo como string (BR "DD/MM/YYYY" nao ordena).
 */
function agoraLocalISO(data = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}` +
    `T${p(data.getHours())}:${p(data.getMinutes())}:${p(data.getSeconds())}`
  )
}

/**
 * CONFIRMADO com um POST de teste real contra o Nomus de producao em 2026-07-15 (ver
 * ferramentas/teste-formato-data.js): o POST /apontamentos exige "DD/MM/YYYY HH:mm:ss",
 * nao ISO — apesar do exemplo do prompt original mostrar ISO. Um payload em ISO e
 * recusado com HTTP 406 ("campo preenchido em formato incorreto"), entao o risco nao era
 * gravar data errada silenciosamente — mas ainda assim tinha que ser corrigido, ou nenhum
 * apontamento seria gravado. So converte NA BORDA, ao montar o payload — o resto do app
 * segue em ISO internamente.
 */
function paraFormatoNomus(localISO) {
  const [data, hora] = localISO.split('T')
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano} ${hora}`
}

const DATA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

/**
 * O fim do apontamento e o instante em que o operador tocou em FINALIZAR, nao o do
 * Confirmar: quando a atividade exige quantidade, os segundos gastos digitando nao podem
 * virar tempo produzido. A tela manda o instante do toque e o servidor confere se ele faz
 * sentido — fora da janela (relogio do terminal errado, tela parada), vale o horario daqui.
 */
function instanteFinalValido(instante, inicioDoSegmento) {
  if (!DATA_HORA.test(instante ?? '')) return null
  const agora = agoraLocalISO()
  if (instante > agora) return null // futuro
  if (inicioDoSegmento && instante < inicioDoSegmento) return null // antes de comecar
  return instante
}

// --- Terminal ------------------------------------------------------------------------
app.get(
  '/api/terminal',
  asyncRoute(async (_req, res) => {
    const funcionario = await funcionarioDoTerminal()

    const limiteNomus = Number(funcionario.limiteApontamentosSimultaneos)
    const limite = Number.isFinite(limiteNomus) && limiteNomus > 0 ? limiteNomus : config.limiteFallback

    res.json({
      funcionario: { id: funcionario.id, nome: funcionario.nome, matricula: funcionario.matricula },
      limiteApontamentosSimultaneos: limite, // 0 = sem limite
    })
  }),
)

const paraTela = (a) => ({
  id: a.id,
  nome: a.nome,
  aptQtdProduzida: a.aptQtdProduzida ?? false,
  aptPercentualProdAndamento: a.aptPercentualProdAndamento ?? false,
  tratamentoQtde: a.tratamentoQtde ?? null,
})

app.get(
  '/api/atividades',
  asyncRoute(async (req, res) => {
    const idRecurso = Number(req.query.idRecurso)
    if (!Number.isFinite(idRecurso)) throw new AppError('Parametro idRecurso e obrigatorio.')
    const atividades = await nomus.atividades(idRecurso)
    res.json(atividades.filter((a) => a.ativo !== false).map(paraTela))
  }),
)

/**
 * Motivos de parada — sao atividades do proprio Nomus, entao a parada vira apontamento de
 * verdade no ERP e o supervisor ve o motivo em relatorio.
 *
 * A API nao tem flag "isto e uma parada". O criterio usado: quem PARA nao produz peca,
 * entao atividade que pede quantidade ou percentual (Producao, Retrabalho) nao e motivo de
 * parada. Sem esse filtro a tela ofereceria "pausar por motivo: Producao".
 * NOMUS_ATIVIDADES_PARADA (nomes separados por virgula) fixa a lista quando o cadastro nao
 * seguir essa logica.
 */
app.get(
  '/api/motivos-parada',
  asyncRoute(async (req, res) => {
    const idOperacaoOrdem = Number(req.query.idOperacaoOrdem)
    const aberto = andamento.porOperacao(idOperacaoOrdem)
    if (!aberto) throw new AppError('Este processo nao esta em andamento.', 409, 'NAO_INICIADO')

    const atividades = (await nomus.atividades(aberto.idRecurso)).filter((a) => a.ativo !== false)
    const permitidos = config.atividadesParada

    const motivos = atividades
      .filter((a) => Number(a.id) !== Number(aberto.idAtividade)) // nao pausar "para" o que ja faz
      .filter((a) =>
        permitidos
          ? permitidos.includes(a.nome?.trim().toLowerCase())
          : !a.aptQtdProduzida && !a.aptPercentualProdAndamento,
      )

    res.json(motivos.map(paraTela))
  }),
)

// --- Leitura dos dois codigos de barras ----------------------------------------------
app.post(
  '/api/resolver-operacao',
  asyncRoute(async (req, res) => {
    const { codigoOrdem, codigoProcesso } = req.body ?? {}
    const operacao = await resolverOperacao(codigoOrdem, codigoProcesso)
    res.json({ ...operacao, emAndamento: andamento.porOperacao(operacao.idOperacaoOrdem) })
  }),
)

// --- Iniciar / Finalizar --------------------------------------------------------------
app.get('/api/andamento', (_req, res) => res.json(andamento.listar()))

app.post(
  '/api/iniciar',
  asyncRoute(async (req, res) => {
    const { codigoOrdem, codigoProcesso, idAtividade } = req.body ?? {}
    const operacao = await resolverOperacao(codigoOrdem, codigoProcesso)

    // O recurso sai do centro de trabalho da etapa lida, nao do terminal: uma unica maquina
    // aponta as ordens de todos os setores.
    const recurso = await resolverRecursoDaOperacao(operacao)
    const idRecurso = recurso.id

    const jaAberto = andamento.porOperacao(operacao.idOperacaoOrdem)

    // Iniciar sobre um processo pausado = retomar: fecha o segmento de parada e volta a produzir.
    if (jaAberto?.estado === PAUSADO) {
      const retomado = andamento.fecharSegmento(jaAberto.id, agoraLocalISO(), {
        estado: PRODUZINDO,
        inicio: agoraLocalISO(),
      })
      console.log(`[retomar] ${retomado.nomeOrdem}/${retomado.operacao} apos ${jaAberto.paradaAtual?.nomeAtividade}`)
      return res.status(200).json({ ...retomado, retomado: true })
    }

    if (jaAberto) {
      throw new AppError(
        `A ordem ${operacao.nomeOrdem} / processo ${operacao.operacao} ja esta em producao desde ${jaAberto.dataHoraInicial.slice(11, 16)}` +
          (jaAberto.nomeFuncionario ? ` (${jaAberto.nomeFuncionario})` : '') +
          '.',
        409,
        'JA_EM_ANDAMENTO',
      )
    }

    const [funcionario, atividade] = await Promise.all([
      funcionarioDoTerminal(),
      resolverAtividade(idRecurso, idAtividade),
    ])

    const limiteNomus = Number(funcionario.limiteApontamentosSimultaneos)
    const limite = Number.isFinite(limiteNomus) && limiteNomus > 0 ? limiteNomus : config.limiteFallback
    if (limite > 0 && andamento.contarPorFuncionario(funcionario.id) >= limite) {
      throw new AppError(
        `${funcionario.nome} ja esta com ${limite} apontamentos simultaneos (limite do Nomus). Finalize um antes de iniciar outro.`,
        409,
        'LIMITE_ATINGIDO',
      )
    }

    const registro = andamento.iniciar({
      idOperacaoOrdem: operacao.idOperacaoOrdem,
      idOrdem: operacao.idOrdem,
      nomeOrdem: operacao.nomeOrdem,
      operacao: operacao.operacao,
      descricao: operacao.descricao,
      idRecurso,
      nomeRecurso: recurso.nome,
      idAtividade: atividade.id,
      nomeAtividade: atividade.nome,
      idFuncionario: funcionario.id,
      nomeFuncionario: funcionario.nome,
      dataHoraInicial: agoraLocalISO(),
    })

    console.log(`[iniciar] ${registro.nomeOrdem}/${registro.operacao} por ${registro.nomeFuncionario}`)
    res.status(201).json(registro)
  }),
)

app.post(
  '/api/pausar',
  asyncRoute(async (req, res) => {
    const { codigoOrdem, codigoProcesso, idAtividadeParada } = req.body ?? {}
    const operacao = await resolverOperacao(codigoOrdem, codigoProcesso)

    const aberto = andamento.porOperacao(operacao.idOperacaoOrdem)
    if (!aberto) {
      throw new AppError(
        `A ordem ${operacao.nomeOrdem} / processo ${operacao.operacao} nao esta em producao. Nao ha o que pausar.`,
        409,
        'NAO_INICIADO',
      )
    }
    if (aberto.estado === PAUSADO) {
      throw new AppError(
        `Este processo ja esta parado desde ${aberto.dataHoraInicial.slice(11, 16)} (${aberto.paradaAtual?.nomeAtividade}). Use Iniciar para retomar.`,
        409,
        'JA_PAUSADO',
      )
    }

    const parada = (await nomus.atividades(aberto.idRecurso)).find(
      (a) => Number(a.id) === Number(idAtividadeParada),
    )
    if (!parada) throw new AppError('Escolha um motivo de parada.', 400, 'MOTIVO_INDEFINIDO')

    // Nada vai pro Nomus agora: so fecha o segmento de producao e abre um de parada. Gravar
    // aqui faria o kanban tratar a etapa como concluida e mover o card no meio do almoco.
    const pausado = andamento.fecharSegmento(aberto.id, agoraLocalISO(), {
      estado: PAUSADO,
      paradaAtual: { idAtividade: parada.id, nomeAtividade: parada.nome },
      inicio: agoraLocalISO(),
    })

    console.log(`[pausar] ${pausado.nomeOrdem}/${pausado.operacao} — ${parada.nome}`)
    res.json(pausado)
  }),
)

app.post(
  '/api/finalizar',
  asyncRoute(async (req, res) => {
    const { codigoOrdem, codigoProcesso, quantidade, percentualProdutoAndamento, instanteFinal } =
      req.body ?? {}
    const operacao = await resolverOperacao(codigoOrdem, codigoProcesso)

    const aberto = andamento.porOperacao(operacao.idOperacaoOrdem)
    if (!aberto) {
      throw new AppError(
        `A ordem ${operacao.nomeOrdem} / processo ${operacao.operacao} nao esta em producao. Inicie antes de finalizar.`,
        409,
        'NAO_INICIADO',
      )
    }

    const atividade = (await nomus.atividades(aberto.idRecurso)).find(
      (a) => Number(a.id) === Number(aberto.idAtividade),
    )

    // A atividade decide o que o Nomus exige; a tela pergunta so quando e necessario.
    if (atividade?.aptQtdProduzida && !(Number(quantidade) > 0)) {
      throw new AppError(
        `A atividade "${atividade.nome}" exige a quantidade produzida.`,
        422,
        'QUANTIDADE_OBRIGATORIA',
      )
    }
    if (atividade?.aptPercentualProdAndamento && !Number.isFinite(Number(percentualProdutoAndamento))) {
      throw new AppError(
        `A atividade "${atividade.nome}" exige o percentual concluido.`,
        422,
        'PERCENTUAL_OBRIGATORIO',
      )
    }

    // Fecha o intervalo em curso: agora todo o trabalho esta em `segmentos`.
    const fim = instanteFinalValido(instanteFinal, aberto.dataHoraInicial) ?? agoraLocalISO()
    const registro = andamento.fecharSegmento(aberto.id, fim)

    // Segmento de duracao zero (retomou e finalizou no mesmo segundo) nao diz nada e o Nomus
    // pode recusar — o que derrubaria o Finalizar com os anteriores ja gravados e sem como
    // desfazer. Se TODOS forem zero, manda um: sem apontamento a etapa nunca conclui.
    // O indice ORIGINAL viaja junto: e ele que marcarEnviado usa, e filtrar desalinharia o
    // retry, que passaria a marcar o segmento errado.
    const comIndice = registro.segmentos.map((seg, i) => ({ seg, i }))
    const uteis = comIndice.filter(({ seg }) => seg.fim > seg.inicio)
    const aEnviar = uteis.length > 0 ? uteis : comIndice.slice(0, 1)

    // A quantidade vai toda no ULTIMO segmento de producao. Reparti-la entre os intervalos
    // seria inventar dado — ninguem sabe quanto saiu antes e depois do almoco. O total da
    // operacao fica correto, que e o que o Nomus soma.
    const ultimaProducao = aEnviar.filter(({ seg }) => seg.tipo === 'PRODUCAO').at(-1)?.i

    const enviados = []
    for (const { seg, i } of aEnviar) {
      if (seg.enviado) continue // retry: nao reenvia o que o Nomus ja gravou

      const ultimo = i === ultimaProducao
      const payload = {
        dataHoraInicial: paraFormatoNomus(seg.inicio),
        dataHoraFinal: paraFormatoNomus(seg.fim),
        idAtividade: Number(seg.idAtividade),
        idFuncionario: Number(registro.idFuncionario),
        idOperacaoOrdem: Number(registro.idOperacaoOrdem),
        idRecurso: Number(registro.idRecurso),
        percentualProdutoAndamento: ultimo ? Number(percentualProdutoAndamento ?? 0) : 0,
        quantidade: ultimo ? Number(quantidade ?? 0) : 0,
        unidadeMedida: '',
        unidadesMedidaSecundarias: [],
      }

      // Se o segundo POST falhar, o primeiro ja esta no Nomus e nao ha endpoint pra desfazer.
      // Marcar um a um garante que o retry mande so o que falta, sem duplicar.
      await nomus.criarApontamento(payload)
      andamento.marcarEnviado(registro.id, i)
      enviados.push(payload)
    }

    // So sai do store depois que TODOS os segmentos entraram no Nomus.
    andamento.remover(registro.id)

    console.log(
      `[finalizar] ${registro.nomeOrdem}/${registro.operacao} — ${enviados.length} apontamento(s) gravado(s)`,
    )
    res.status(201).json({ registro, apontamentos: enviados })
  }),
)

app.delete(
  '/api/andamento/:id',
  asyncRoute(async (req, res) => {
    if (!andamento.remover(req.params.id)) throw new AppError('Apontamento em andamento nao encontrado.', 404)
    res.status(204).end()
  }),
)

// --- Kanban ---------------------------------------------------------------------------
app.get(
  '/api/kanban',
  asyncRoute(async (_req, res) => {
    // Sequencial, nao Promise.all: cada uma dessas pagina sozinha com sua propria pausa
    // entre paginas, mas rodando as tres AO MESMO TEMPO a taxa de requisicoes somada ao
    // Nomus triplica — foi isso que manteve o 429 mesmo depois de pausar cada uma
    // individualmente (ver incidente 2026-07-15). So importa no boot frio (tudo sem
    // cache); com o cache quente (a maioria das vezes) isso e essencialmente instantaneo
    // dos tres jeitos, entao nao ha custo real em serializar.
    const operacoes = await nomus.todasOperacoes()
    const apontamentos = await nomus.apontamentos()
    const pedidosPorOrdem = await mapaPedidosPorOrdem()
    const quadro = montarKanban({
      operacoes,
      apontamentos,
      emAndamento: andamento.listar(),
      pedidosPorOrdem,
    })
    res.json({ ...quadro, atualizadoEm: new Date().toISOString() })
  }),
)

// --- Planejamento (PCP) ----------------------------------------------------------------
// So nosso, nunca vai pro Nomus — ver server/planejamento.js.
app.get('/api/planejamento', (_req, res) => res.json(planejamento.listar()))

app.post(
  '/api/planejamento',
  asyncRoute(async (req, res) => {
    const { idOrdem, idOperacaoOrdem, nomeOrdem, pedido, produto, codigoProduto, quantidade, unidadeMedida, data } =
      req.body ?? {}
    if (idOrdem == null || idOperacaoOrdem == null || !nomeOrdem) {
      throw new AppError('idOrdem, idOperacaoOrdem e nomeOrdem sao obrigatorios.', 400)
    }
    if (!REGEX_DATA.test(data ?? '')) {
      throw new AppError('data precisa estar no formato AAAA-MM-DD.', 400)
    }
    const registro = planejamento.agendar({
      idOrdem,
      idOperacaoOrdem,
      nomeOrdem,
      pedido,
      produto,
      codigoProduto,
      quantidade,
      unidadeMedida,
      data,
    })
    res.status(201).json(registro)
  }),
)

app.patch(
  '/api/planejamento/:id',
  asyncRoute(async (req, res) => {
    const { data } = req.body ?? {}
    if (!REGEX_DATA.test(data ?? '')) {
      throw new AppError('data precisa estar no formato AAAA-MM-DD.', 400)
    }
    const registro = planejamento.mover(req.params.id, data)
    if (!registro) throw new AppError('Item de planejamento nao encontrado.', 404)
    res.json(registro)
  }),
)

app.delete(
  '/api/planejamento/:id',
  asyncRoute(async (req, res) => {
    if (!planejamento.remover(req.params.id)) {
      throw new AppError('Item de planejamento nao encontrado.', 404)
    }
    res.status(204).end()
  }),
)

app.get('/api/saude', (_req, res) => res.json({ ok: true }))

// --- Front-end buildado ---------------------------------------------------------------
const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(dist, 'index.html'), (erro) => {
    if (erro) res.status(503).send('Front-end nao foi buildado ainda. Rode: npm run build')
  })
})

// eslint-disable-next-line no-unused-vars -- o Express so reconhece handler de erro com 4 args
app.use((erro, _req, res, _next) => {
  const status = erro.status ?? 500
  if (status >= 500) console.error('[erro]', erro)
  else console.warn('[aviso]', erro.message)

  const corpo = { mensagem: erro.message ?? 'Erro inesperado.' }
  if (erro.codigo) corpo.codigo = erro.codigo
  if (erro instanceof NomusError && erro.retryAfterMs) corpo.retryAfterMs = erro.retryAfterMs
  // Vai junto com ATIVIDADE_INDEFINIDA: e o que a tela usa pra montar o seletor de
  // atividade em vez de deixar o operador travado.
  if (erro.idRecurso) corpo.idRecurso = erro.idRecurso
  res.status(status).json(corpo)
})

app.listen(config.porta, () => {
  console.log(`GFERRO — Apontamento de Producao em http://localhost:${config.porta}`)
  console.log(`Nomus: ${config.baseUrl} | matricula do terminal: ${config.matricula}`)
})
