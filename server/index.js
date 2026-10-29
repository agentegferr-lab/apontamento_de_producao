import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, validarConfig } from './config.js'
import { nomus, NomusError, ultimaAtualizacao, forcarAtualizacao } from './nomus.js'
import { resolverOperacao, ResolucaoError } from './resolver.js'
import { andamento, PRODUZINDO, PAUSADO } from './andamento.js'
import PDFDocument from 'pdfkit'
import { montarKanban } from './kanban.js'
import { montarRelatorioProducao } from './relatorioProducao.js'
import { gerarPdfRelatorioProducao } from './relatorioProducaoPdf.js'
import { resolverRecursoDaOperacao } from './recursos.js'
import { situacaoDaOrdem, idsRecusadosPeloNomus } from './ordens.js'
import { apontamentosDaOperacao, mensagemProcessoJaApontado } from './duplicidade.js'
import { mapaPedidosPorOrdem, buscarPedidoPorCodigo, ultimaAtualizacaoOrdens, forcarOrdensRecentes } from './pedidos.js'
import { planejamento, REGEX_DATA } from './planejamento.js'
import { pedidosOcultos } from './pedidosOcultos.js'
import { materiaisParaItens } from './materiais.js'
import { sugerirPlanejamento } from './ia.js'
import { AppError, asyncRoute } from './erros.js'
import { caminhoes } from './caminhoes.js'
import { motoristas } from './motoristas.js'
import { entregas } from './entregas.js'

try {
  validarConfig()
} catch (erro) {
  console.error(erro.message)
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '256kb' }))

// Registrado ANTES das rotas: toda escrita invalida o quadro em cache (ver montarQuadroAtual).
app.use((req, res, next) => {
  if (req.method !== 'GET') {
    invalidarQuadro()
    res.on('finish', invalidarQuadro)
  }
  next()
})

/**
 * So pro boot do terminal (GET /api/terminal, ver App.jsx): confirma que a conexao com o
 * Nomus funciona usando a matricula fixa do .env como referencia. NAO e mais quem assina os
 * apontamentos — isso agora e por operador, ver resolverFuncionarioPorMatricula abaixo. Um
 * erro aqui e sempre do SERVIDOR (a matricula de referencia esta errada no .env), por isso
 * NomusError com status 500 continua fazendo sentido.
 */
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
 * Quem assina o apontamento: a matricula que o OPERADOR bipou no cracha (ver
 * TelaLeitura.jsx), uma por pessoa — nao mais a matricula fixa do terminal em .env. Erro
 * aqui e do OPERADOR (bipou errado, ou esta inativo no Nomus), por isso AppError 400/403 em
 * vez do NomusError 500 de funcionarioDoTerminal (aquele e erro de configuracao do servidor).
 */
async function resolverFuncionarioPorMatricula(matricula) {
  const alvo = String(matricula ?? '').trim()
  if (!alvo) {
    throw new AppError('Leia o crachá (matrícula do colaborador) antes de iniciar.', 400, 'MATRICULA_OBRIGATORIA')
  }
  const funcionario = await nomus.funcionarioPorMatricula(alvo)
  if (!funcionario) {
    throw new AppError(`Nenhum colaborador com a matrícula ${alvo} no Nomus.`, 404, 'MATRICULA_INVALIDA')
  }
  if (funcionario.ativo === false) {
    throw new AppError(`${funcionario.nome} está inativo no Nomus.`, 403, 'FUNCIONARIO_INATIVO')
  }
  return funcionario
}

/**
 * Trava: o mesmo processo da mesma ordem so pode ser apontado UMA vez (ver server/duplicidade.js).
 * Confere primeiro a lista em cache (instantaneo — inclui o que este servidor acabou de gravar)
 * e depois pergunta ao Nomus direto pra esse processo, que pega o que o cache ainda nao viu.
 * Se o Nomus nao responder, vale o que o cache disse: nao trava o operador por causa de um 429.
 */
async function garantirProcessoNaoApontado(operacao) {
  const id = operacao.idOperacaoOrdem
  let existentes = apontamentosDaOperacao(await nomus.apontamentos().catch(() => []), id)
  if (existentes.length === 0) {
    existentes = apontamentosDaOperacao(await nomus.apontamentosDaOperacao(id).catch(() => []), id)
  }
  if (existentes.length > 0) {
    throw new AppError(mensagemProcessoJaApontado(operacao, existentes), 409, 'PROCESSO_JA_APONTADO')
  }
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

    res.json({
      funcionario: { id: funcionario.id, nome: funcionario.nome, matricula: funcionario.matricula },
      limiteApontamentosSimultaneos: 0,
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
    const { codigoOrdem, codigoProcesso, idAtividade, matricula } = req.body ?? {}
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

    // So aqui (depois do "retomar"): um processo pausado ainda esta aberto e nao conta como apontado.
    await garantirProcessoNaoApontado(operacao)

    const [funcionario, atividade] = await Promise.all([
      resolverFuncionarioPorMatricula(matricula),
      resolverAtividade(idRecurso, idAtividade),
    ])

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
// Sequencial, nao Promise.all: cada uma dessas pagina sozinha com sua propria pausa entre
// paginas, mas rodando as tres AO MESMO TEMPO a taxa de requisicoes somada ao Nomus
// triplica — foi isso que manteve o 429 mesmo depois de pausar cada uma individualmente
// (ver incidente 2026-07-15). So importa no boot frio (tudo sem cache); com o cache quente
// (a maioria das vezes) isso e essencialmente instantaneo dos tres jeitos, entao nao ha
// custo real em serializar. Compartilhado com /api/planejamento/sugestao (ver server/ia.js).
async function calcularQuadro() {
  const operacoes = await nomus.todasOperacoes()
  const apontamentos = await nomus.apontamentos()
  // As ordens que o quadro mostra entram na frente da fila de busca de ordens (server/ordens.js).
  const pedidosPorOrdem = await mapaPedidosPorOrdem(operacoes.map((o) => o.idOrdem))
  return montarKanban({
    operacoes,
    apontamentos,
    emAndamento: andamento.listar(),
    pedidosPorOrdem,
    pedidosOcultos: pedidosOcultos.codigos(),
  })
}

// Varias telas e o polling de 30s de cada navegador pedem o mesmo quadro: recalcular
// milhares de operacoes a cada chamada e trabalho jogado fora. Reaproveita o resultado por
// poucos segundos e junta chamadas simultaneas numa so; qualquer escrita (POST/PATCH/DELETE)
// invalida na hora, entao o card continua andando assim que o operador aponta.
const TTL_QUADRO_MS = 5_000
let quadroMemo = null // { em, promessa }
function invalidarQuadro() {
  quadroMemo = null
}
function montarQuadroAtual() {
  if (quadroMemo && Date.now() - quadroMemo.em < TTL_QUADRO_MS) return quadroMemo.promessa
  const promessa = calcularQuadro()
  const memo = { em: Date.now(), promessa }
  quadroMemo = memo
  promessa.catch(() => {
    if (quadroMemo === memo) quadroMemo = null
  })
  return promessa
}

/**
 * "Ja comecou?" pra uma operacao, segundo o quadro atual — reaproveita exatamente o mesmo
 * criterio que decide o que vai pra fila invisivel (ver server/kanban.js): quem esta em
 * filaAguardando e quem nunca teve nenhuma etapa tocada. Usado pra empurrar pro dia
 * seguinte os itens do Planejamento vencidos sem apontamento (ver planejamento.aplicarAtrasos).
 */
function estaIniciadoNoQuadro(quadro) {
  const idsNaFila = new Set((quadro.filaAguardando ?? []).map((c) => Number(c.idOperacaoOrdem)))
  return (idOperacaoOrdem) => !idsNaFila.has(Number(idOperacaoOrdem))
}

/**
 * A data de "quando os dados foram buscados de verdade no Nomus" — NAO "agora", que
 * mentiria sempre que o cache estivesse servindo um valor vencido (stale-while-revalidate,
 * ver server/nomus.js). Pega a mais ANTIGA das tres fontes: se uma delas estiver atrasada,
 * o quadro inteiro pode estar incompleto por causa dela.
 *
 * INCIDENTE (2026-08-07): faltava a lista de `/ordens` aqui (so tinha operacoes/apontamentos)
 * — ela ficou presa numa varredura velha por dias (mesmo padrao do incidente de
 * operacoes:todas em 2026-07-27, ver server/nomus.js) sem NENHUM sinal na tela: o rotulo
 * dizia "atualizado agora" enquanto ordens novas (idOrdem alto) apareciam sem pedido/produto/
 * valor, porque ainda nao tinham entrado na ultima varredura bem-sucedida.
 */
function dataDeAtualizacaoDoQuadro() {
  const datas = [ultimaAtualizacao('operacoes:todas'), ultimaAtualizacao('apontamentos'), ultimaAtualizacaoOrdens()].filter(
    Boolean,
  )
  return datas.length ? new Date(Math.min(...datas.map((d) => d.getTime()))) : new Date()
}

app.get(
  '/api/kanban',
  asyncRoute(async (_req, res) => {
    const quadro = await montarQuadroAtual()
    res.json({ ...quadro, atualizadoEm: dataDeAtualizacaoDoQuadro().toISOString() })
  }),
)


/**
 * Forca uma atualizacao nova no Nomus AGORA em vez de esperar o proximo ciclo de fundo
 * (ate REFRESH_FUNDO_INTERVALO_MS + CACHE_TTL_MS, ver config.js) — pro botao "Atualizar" do
 * Acompanhamento, quando uma ordem nova nao apareceu ainda. So MARCA como vencidas as
 * chaves do quadro (operacoes/apontamentos/ordens); nao apaga nem espera a varredura
 * terminar — devolve o quadro atual na hora e atualiza em segundo plano (ver
 * nomus.forcarAtualizacao). Apagar o cache e esperar de verdade travaria essa chamada por
 * minutos sob throttle do Nomus, o mesmo padrao do INCIDENTE 2026-07-27 em server/nomus.js.
 */
app.post(
  '/api/kanban/atualizar',
  asyncRoute(async (_req, res) => {
    forcarAtualizacao(['operacoes:todas', 'apontamentos'])
    forcarOrdensRecentes()
    invalidarQuadro()
    const quadro = await montarQuadroAtual()
    res.json({ ...quadro, atualizadoEm: dataDeAtualizacaoDoQuadro().toISOString() })
  }),
)

// Relatorio de producao por centro de trabalho (Corte, Pintura...) num periodo — historico
// ja apontado, diferente do /api/kanban (que mostra o que falta fazer agora). Ver
// server/relatorioProducao.js.
async function buscarRelatorioProducao(inicio, fim) {
  if (!REGEX_DATA.test(inicio ?? '') || !REGEX_DATA.test(fim ?? '')) {
    throw new AppError('inicio e fim devem estar no formato AAAA-MM-DD.', 400)
  }
  const [operacoes, apontamentos, funcionarios, pedidosPorOrdem] = await Promise.all([
    nomus.todasOperacoes(),
    nomus.apontamentos(),
    nomus.funcionarios(),
    mapaPedidosPorOrdem(),
  ])
  return montarRelatorioProducao({ operacoes, apontamentos, funcionarios, pedidosPorOrdem, inicio, fim })
}

app.get(
  '/api/relatorio-producao',
  asyncRoute(async (req, res) => {
    const relatorio = await buscarRelatorioProducao(req.query.inicio, req.query.fim)
    res.json({ ...relatorio, atualizadoEm: dataDeAtualizacaoDoQuadro().toISOString() })
  }),
)

// PDF pra baixar direto (nao e window.print() — um arquivo de verdade, ver
// server/relatorioProducaoPdf.js). `rotulo` vem do cliente, que ja calculou o texto exibido
// na tela (ver client/src/producaoCampos.js) — evita duplicar a formatacao de periodo aqui.
app.get(
  '/api/relatorio-producao/pdf',
  asyncRoute(async (req, res) => {
    const { inicio, fim, rotulo } = req.query
    const relatorio = await buscarRelatorioProducao(inicio, fim)

    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-producao-${inicio}-a-${fim}.pdf"`)
    doc.pipe(res)
    gerarPdfRelatorioProducao(doc, {
      periodoRotulo: rotulo || `${inicio} a ${fim}`,
      porCentro: relatorio.porCentro,
      detalhado: relatorio.detalhado,
      geradoEm: new Date().toLocaleString('pt-BR'),
    })
    doc.end()
  }),
)

// Pedidos escondidos do kanban a pedido do usuario (ver server/pedidosOcultos.js) — reversivel,
// nao mexe no Nomus. `codigo` e o numero normalizado (ex.: "PD 01038" -> "1038").
app.get(
  '/api/pedidos-ocultos',
  asyncRoute(async (_req, res) => {
    res.json(pedidosOcultos.listar())
  }),
)

app.post(
  '/api/pedidos-ocultos',
  asyncRoute(async (req, res) => {
    const { pedido } = req.body ?? {}
    if (!pedido) throw new AppError('pedido e obrigatorio.', 400)
    const registro = pedidosOcultos.ocultar(pedido)
    if (!registro) throw new AppError('pedido invalido.', 400)
    res.status(201).json(registro)
  }),
)

app.delete(
  '/api/pedidos-ocultos/:codigo',
  asyncRoute(async (req, res) => {
    if (!pedidosOcultos.mostrar(req.params.codigo)) {
      throw new AppError('Pedido oculto nao encontrado.', 404)
    }
    res.status(204).end()
  }),
)

// Preenchimento automatico de cliente/metragem/valor no lancamento de Entregas (ver
// TelaEntregas.jsx) a partir do que ja esta resolvido do Nomus (ver server/pedidos.js,
// buscarPedidoPorCodigo) — o motorista so digita o numero do pedido.
app.get(
  '/api/pedidos/buscar',
  asyncRoute(async (req, res) => {
    const { codigo } = req.query
    if (!codigo) throw new AppError('codigo e obrigatorio.', 400)
    const info = await buscarPedidoPorCodigo(codigo)
    if (!info) throw new AppError('Pedido nao encontrado (ou ainda nao resolvido).', 404)
    res.json(info)
  }),
)

// --- Entregas ----------------------------------------------------------------------------
// Cadastro de caminhoes/motoristas e lancamento de quais pedidos cada motorista entregou —
// so nosso, nunca vai pro Nomus (ver server/caminhoes.js, server/motoristas.js,
// server/entregas.js). Cada modulo ja valida e lanca AppError sozinho, entao as rotas aqui
// so repassam o corpo da requisicao.
app.get(
  '/api/caminhoes',
  asyncRoute(async (_req, res) => res.json(caminhoes.listar())),
)

app.post(
  '/api/caminhoes',
  asyncRoute(async (req, res) => res.status(201).json(caminhoes.criar(req.body ?? {}))),
)

app.patch(
  '/api/caminhoes/:id',
  asyncRoute(async (req, res) => res.json(caminhoes.atualizar(req.params.id, req.body ?? {}))),
)

app.get(
  '/api/motoristas',
  asyncRoute(async (_req, res) => res.json(motoristas.listar())),
)

app.post(
  '/api/motoristas',
  asyncRoute(async (req, res) => res.status(201).json(motoristas.criar(req.body ?? {}))),
)

app.patch(
  '/api/motoristas/:id',
  asyncRoute(async (req, res) => res.json(motoristas.atualizar(req.params.id, req.body ?? {}))),
)

app.get(
  '/api/entregas',
  asyncRoute(async (_req, res) => res.json(entregas.listar())),
)

app.post(
  '/api/entregas',
  asyncRoute(async (req, res) => res.status(201).json(entregas.lancar(req.body ?? {}))),
)

app.delete(
  '/api/entregas/:id',
  asyncRoute(async (req, res) => {
    if (!entregas.remover(req.params.id)) throw new AppError('Lancamento de entrega nao encontrado.', 404)
    res.status(204).end()
  }),
)

// --- Planejamento (PCP) ----------------------------------------------------------------
// So nosso, nunca vai pro Nomus — ver server/planejamento.js.
// Cada item volta com `materiais` (materia-prima explodida da lista de materiais do Nomus,
// ja escalada pela quantidade planejada — ver server/materiais.js) SEMPRE recalculado na
// hora, nunca persistido: assim mover um card de dia (troca so a `data`) refaz a soma do
// dia novo automaticamente, sem guardar um numero que possa ficar desatualizado.
app.get(
  '/api/planejamento',
  asyncRoute(async (_req, res) => {
    // Antes de listar, empurra pro proximo dia util (e marca atrasado) quem passou do dia
    // programado sem nenhum apontamento — ver server/planejamento.js, aplicarAtrasos.
    const quadro = await montarQuadroAtual()
    planejamento.aplicarAtrasos(estaIniciadoNoQuadro(quadro))
    res.json(await materiaisParaItens(planejamento.listar()))
  }),
)

/**
 * Explosao de material SOB DEMANDA pra um unico produto/quantidade — usado pelo modal de
 * detalhes de um card (ver client/src/components/ModalDetalheCard.jsx) quando o card vem do
 * kanban/fila (nao tem `materiais` pronto: so os itens de /api/planejamento passam por
 * materiaisParaItens hoje). Mesma funcao, so que com um item so em vez da lista do dia.
 */
app.post(
  '/api/materiais',
  asyncRoute(async (req, res) => {
    const { idProduto, quantidade } = req.body ?? {}
    if (idProduto == null) throw new AppError('idProduto e obrigatorio.', 400)
    const [comMateriais] = await materiaisParaItens([{ idProduto, quantidade }])
    res.json({ materiais: comMateriais.materiais })
  }),
)

app.post(
  '/api/planejamento',
  asyncRoute(async (req, res) => {
    const {
      idOrdem,
      idOperacaoOrdem,
      nomeOrdem,
      pedido,
      idPedido,
      idProduto,
      produto,
      codigoProduto,
      quantidade,
      unidadeMedida,
      valorTotal,
      data,
    } = req.body ?? {}
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
      idPedido,
      idProduto,
      produto,
      codigoProduto,
      quantidade,
      unidadeMedida,
      valorTotal,
      data,
    })
    const [comMateriais] = await materiaisParaItens([registro])
    res.status(201).json(comMateriais)
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
    const [comMateriais] = await materiaisParaItens([registro])
    res.json(comMateriais)
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

// Sugestao de planejamento por IA (ver server/ia.js) — le um objetivo em texto livre e
// devolve QUAIS ordens do backlog agendar em quais dias, mas nunca agenda nada sozinha: o
// cliente mostra a sugestao num modal e o usuario decide o que aplicar de verdade via
// POST /api/planejamento normal, um por um.
app.post(
  '/api/planejamento/sugestao',
  asyncRoute(async (req, res) => {
    const { objetivo, dataInicio, dataFim } = req.body ?? {}
    if (!objetivo || !objetivo.trim()) {
      throw new AppError('Descreva o objetivo do planejamento antes de gerar a sugestao.', 400)
    }
    if (!REGEX_DATA.test(dataInicio ?? '') || !REGEX_DATA.test(dataFim ?? '')) {
      throw new AppError('Escolha o período (de/até) antes de gerar a sugestão.', 400)
    }
    if (dataInicio > dataFim) {
      throw new AppError('A data "de" precisa ser antes (ou igual a) da data "até".', 400)
    }

    const quadro = await montarQuadroAtual()
    const idsPlanejados = new Set(planejamento.listar().map((i) => Number(i.idOperacaoOrdem)))
    // So ordens que ainda nao entraram em nenhum planejamento e cujo valor do pedido ja
    // resolveu (ver pedidos.js) — sem valor, a IA nao tem como mirar num alvo de faturamento.
    const backlog = (quadro.filaAguardando ?? []).filter(
      (c) => !idsPlanejados.has(Number(c.idOperacaoOrdem)) && c.valorTotal != null,
    )
    if (backlog.length === 0) {
      throw new AppError(
        'Nenhuma ordem em espera com valor de pedido já resolvido pra sugerir agora. Clique em "Atualizar" e tente de novo em alguns minutos.',
        409,
      )
    }

    const sugestao = await sugerirPlanejamento({ objetivo, dataInicio, dataFim, backlog })
    res.json(sugestao)
  }),
)

app.get('/api/saude', (_req, res) => res.json({ ok: true }))

// Por que cada OS do quadro esta sem pedido (ver situacaoDaOrdem em server/ordens.js).
app.get(
  '/api/diagnostico/vinculos',
  asyncRoute(async (_req, res) => {
    const quadro = await montarQuadroAtual()
    const cards = [...quadro.colunas.flatMap((c) => c.cards), ...(quadro.filaAguardando ?? []), ...(quadro.concluidos ?? [])]
    const semPedido = cards.filter((c) => !c.pedido)
    const porMotivo = {}
    for (const c of semPedido) {
      const motivo = c.idPedido != null ? 'pedido-nao-resolvido' : situacaoDaOrdem(Number(c.idOrdem))
      ;(porMotivo[motivo] ??= []).push(c.nomeOrdem)
    }
    res.json({
      cardsNoQuadro: cards.length,
      semPedido: semPedido.length,
      resumo: Object.fromEntries(Object.entries(porMotivo).map(([m, l]) => [m, l.length])),
      porMotivo,
      idsRecusadosPeloNomus: idsRecusadosPeloNomus(),
    })
  }),
)

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

/**
 * Um so timer pra tudo (operacoes, apontamentos, ordens/pedidos), rodando SEQUENCIAL, nao em
 * paralelo — mesmo motivo do comentario em montarQuadroAtual acima: dois timers
 * independentes na mesma cadencia (ver INCIDENTE abaixo) disparam quase no mesmo instante a
 * cada ciclo, somando (nao intercalando) a taxa de requisicoes ao Nomus.
 *
 * INCIDENTE (2026-08-07): iniciarRefreshDeFundo() (operacoes+apontamentos) e
 * iniciarRefreshDeFundoPedidos() (ordens+pedidos) foram chamadas como DOIS setInterval
 * separados, ambos com o mesmo REFRESH_FUNDO_INTERVALO_MS e iniciados um logo apos o outro
 * no boot — na pratica, disparam juntos a cada ciclo. Isso dobrou a carga simultanea sobre
 * a mesma cota do Nomus (cada ciclo virou operacoes+apontamentos+ordens+ate 20 pedidos de
 * uma vez, em vez de intercalado com o polling de 30s do navegador) e gerou uma avalanche de
 * 429 sustentada: nada terminava de resolver entre um ciclo e o proximo, entao o Acompanhamento
 * passou a mostrar so a OS (pedido/valorTotal/dataPedido dependem do pedido resolvido, que
 * nunca conseguia terminar — ver server/pedidos.js). Um timer so, sequencial, evita isso.
 */
function iniciarAtualizacaoDeFundo() {
  const id = setInterval(async () => {
    const operacoes = await nomus.todasOperacoes().catch(() => [])
    await nomus.apontamentos().catch(() => {})
    await mapaPedidosPorOrdem(operacoes.map((o) => o.idOrdem)).catch(() => {})
  }, config.refreshFundoIntervaloMs)
  id.unref?.()
  return id
}

iniciarAtualizacaoDeFundo()
