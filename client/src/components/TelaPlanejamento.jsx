import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import ModalDetalheCard from './ModalDetalheCard.jsx'
import ModalDetalheDia from './ModalDetalheDia.jsx'
import RelatorioImpressao from './RelatorioImpressao.jsx'
import ModalImprimir from './ModalImprimir.jsx'
import ModalSugestaoIA from './ModalSugestaoIA.jsx'
import ModalGerarSugestao from './ModalGerarSugestao.jsx'
import { formatarMoedaBr } from '../numero.js'
import { formatarDataBr } from '../planejamentoCampos.js'

const NOMES_MES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
const DIAS_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']

function chaveData(data) {
  const p = (n) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`
}

/** 6 semanas (42 dias) sempre, comecando no domingo antes (ou igual a) o dia 1 do mes. */
function gerarGradeMes(ano, mes) {
  const primeiroDia = new Date(ano, mes, 1)
  const inicio = new Date(ano, mes, 1 - primeiroDia.getDay())
  return Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i))
}

/**
 * Calendario de planejamento do PCP: arrasta ordens da fila (que ainda nao comecaram nenhum
 * processo, ver kanban.js/filaAguardando) pra um dia do mes. So local — nunca toca o Nomus,
 * ver server/planejamento.js.
 */
export default function TelaPlanejamento() {
  const hoje = useMemo(() => new Date(), [])
  const [mesAtual, setMesAtual] = useState({ ano: hoje.getFullYear(), mes: hoje.getMonth() })
  const [quadro, setQuadro] = useState(null)
  const [plano, setPlano] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [arrastando, setArrastando] = useState(null) // { tipo: 'fila'|'planejado', card|item }
  const [diaSobre, setDiaSobre] = useState(null) // chave do dia com highlight de drop
  const [agora, setAgora] = useState(() => new Date())
  const [detalhe, setDetalhe] = useState(null) // { card, extra } pro modal de detalhes
  const [diaDetalhe, setDiaDetalhe] = useState(null) // chave do dia (AAAA-MM-DD) pro modal do dia inteiro
  const [imprimindo, setImprimindo] = useState(false) // abre o modal de escolher o periodo
  const [periodoImpressao, setPeriodoImpressao] = useState({ inicio: '', fim: '' }) // o que RelatorioImpressao usa
  const deveImprimirRef = useRef(false) // arma o print pro proximo commit — ver useEffect abaixo
  const [pedindoSugestao, setPedindoSugestao] = useState(false) // abre o modal de objetivo/periodo
  const [sugerindo, setSugerindo] = useState(false)
  const [sugestaoIA, setSugestaoIA] = useState(null) // { resumo, sugestoes } vindo do servidor
  const [buscaAgendada, setBuscaAgendada] = useState('') // acha uma OS JA no calendario (diferente da busca da fila acima)
  const [diaEmDestaque, setDiaEmDestaque] = useState(null) // chave do dia (AAAA-MM-DD) pra piscar depois de "ir pra la"
  const destaqueTimeoutRef = useRef(null)
  const [aplicandoSugestao, setAplicandoSugestao] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const [k, p] = await Promise.all([api.kanban(), api.planejamento()])
      setQuadro(k)
      setPlano(p)
      setErro(null)
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    carregar()
    // Sozinho, sem precisar clicar em Atualizar — uma ordem nova (ou que mudou de status)
    // aparece na fila/quadro assim que entrar no cache do servidor.
    const id = setInterval(carregar, 30_000)
    return () => clearInterval(id)
  }, [carregar])

  // So pro cronometro do modal de detalhes, quando o card clicado estiver em producao.
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const idsPlanejados = useMemo(() => new Set(plano.map((i) => i.idOperacaoOrdem)), [plano])

  const fila = useMemo(() => {
    const todos = (quadro?.filaAguardando ?? []).filter((c) => !idsPlanejados.has(c.idOperacaoOrdem))
    const alvo = busca.trim().toLowerCase()
    if (!alvo) return todos
    return todos.filter(
      (c) =>
        c.nomeOrdem?.toLowerCase().includes(alvo) ||
        c.pedido?.toLowerCase().includes(alvo) ||
        c.produto?.toLowerCase().includes(alvo),
    )
  }, [quadro, idsPlanejados, busca])

  const planoPorDia = useMemo(() => {
    const mapa = new Map()
    for (const item of plano) {
      if (!mapa.has(item.data)) mapa.set(item.data, [])
      mapa.get(item.data).push(item)
    }
    return mapa
  }, [plano])

  // Acha uma OS que JA esta no calendario (a busca da fila acima nunca encontra estas, de
  // proposito — ver o filtro de idsPlanejados na fila). Ordenado por data: quem tem a mesma
  // OS em vários dias (raro, mas possível) ve a mais próxima primeiro.
  const resultadosAgendados = useMemo(() => {
    const alvo = buscaAgendada.trim().toLowerCase()
    if (!alvo) return []
    return plano
      .filter(
        (item) =>
          item.nomeOrdem?.toLowerCase().includes(alvo) ||
          item.pedido?.toLowerCase().includes(alvo) ||
          item.produto?.toLowerCase().includes(alvo),
      )
      .sort((a, b) => a.data.localeCompare(b.data))
      .slice(0, 20)
  }, [plano, buscaAgendada])

  // Pula pro mes do item e pisca o dia por alguns segundos — sem isso, achar a OS na busca
  // nao adianta muito se ela estiver num mes diferente do que a grade esta mostrando agora.
  function irParaAgendado(item) {
    const [ano, mes] = item.data.split('-').map(Number)
    setMesAtual({ ano, mes: mes - 1 })
    setDiaEmDestaque(item.data)
    setBuscaAgendada('')
    clearTimeout(destaqueTimeoutRef.current)
    destaqueTimeoutRef.current = setTimeout(() => setDiaEmDestaque(null), 4000)
  }

  useEffect(() => () => clearTimeout(destaqueTimeoutRef.current), [])

  // window.print() precisa rodar SO depois que o DOM ja reflete o `periodoImpressao` novo
  // (RelatorioImpressao.jsx re-renderiza via itensRelatorio, que depende dele) — chamar print
  // no mesmo handler que muda o estado imprimiria o periodo ANTERIOR, porque o React so
  // aplica a mudanca depois que o handler termina. O ref arma o disparo so quando quem pediu
  // foi handleImprimir (nao no primeiro render nem em qualquer outra mudanca de estado).
  useEffect(() => {
    if (!deveImprimirRef.current) return
    deveImprimirRef.current = false
    window.print()
  }, [periodoImpressao])

  // idOperacaoOrdem -> card completo (com status de producao), pra abrir o modal de
  // detalhes de um item ja agendado com informacao atualizada quando disponivel — o
  // registro do planejamento em si so guarda um retrato (nomeOrdem/pedido/produto).
  const cardVivoPorOperacao = useMemo(() => {
    const mapa = new Map()
    if (!quadro) return mapa
    for (const coluna of quadro.colunas) {
      for (const card of coluna.cards) mapa.set(card.idOperacaoOrdem, card)
    }
    for (const card of quadro.concluidos ?? []) mapa.set(card.idOperacaoOrdem, card)
    for (const card of quadro.filaAguardando ?? []) mapa.set(card.idOperacaoOrdem, card)
    return mapa
  }, [quadro])

  // idOrdem (a ORDEM, nao a operacao) de quem ja tem algum progresso — usado so pra cor (ver
  // statusIniciado abaixo). Precisa ser por ordem: o item de planejamento guarda o
  // idOperacaoOrdem de quando foi agendado (normalmente a 1a etapa, ex. Corte), mas depois que
  // essa etapa e apontada o "card vivo" passa a existir com o id da etapa SEGUINTE (Pintura) —
  // buscar pelo id antigo em cardVivoPorOperacao nunca mais acha nada, e o card ficava cinza
  // (nem verde nem amarelo) mesmo com a ordem em producao ha tempos.
  const ordensComProgresso = useMemo(() => {
    const s = new Set()
    if (!quadro) return s
    for (const coluna of quadro.colunas) for (const card of coluna.cards) s.add(card.idOrdem)
    for (const card of quadro.concluidos ?? []) s.add(card.idOrdem)
    return s
  }, [quadro])

  const dias = useMemo(() => gerarGradeMes(mesAtual.ano, mesAtual.mes), [mesAtual])
  const chaveHoje = useMemo(() => chaveData(hoje), [hoje])

  /**
   * true = a ORDEM ja deu entrada em algum processo (verde), false = ainda nao (amarelo),
   * null = quadro nao carregou ainda. Por ordem, nao por etapa — ver ordensComProgresso acima
   * pro motivo. Mesmo criterio que kanban.js usa pra decidir o que vai pra fila invisivel:
   * uma ordem so fica "intocada" enquanto nenhuma etapa dela foi apontada.
   */
  function statusIniciado(item) {
    if (!quadro) return null
    return ordensComProgresso.has(item.idOrdem)
  }

  /**
   * Verde ganha de tudo (ja produzindo/ja passou por alguma etapa, mesmo que tenha chegado
   * atrasado). Vermelho e o servidor avisando que empurrou o card pro dia de hoje sozinho por
   * falta de apontamento (ver server/planejamento.js, aplicarAtrasos) — so faz sentido
   * enquanto ainda nao comecou. Amarelo e o "normal": agendado, dentro do prazo, aguardando.
   */
  function classeDoCard(item) {
    const iniciado = statusIniciado(item)
    if (iniciado) return 'planejamento-card--iniciado'
    if (item.atrasado) return 'planejamento-card--atrasado'
    if (iniciado === false) return 'planejamento-card--nao-iniciado'
    return ''
  }

  // Pro relatorio de impressao: TODAS as ordens planejadas dentro do periodo escolhido no
  // modal de imprimir, nao so as do mes visivel no momento — ver handleImprimir abaixo.
  const itensRelatorio = useMemo(() => {
    const { inicio, fim } = periodoImpressao
    return plano
      .filter((item) => (!inicio || item.data >= inicio) && (!fim || item.data <= fim))
      .sort((a, b) => a.data.localeCompare(b.data))
  }, [plano, periodoImpressao])
  const periodoLabel = periodoImpressao.inicio && periodoImpressao.fim
    ? `Período: ${formatarDataBr(periodoImpressao.inicio)} até ${formatarDataBr(periodoImpressao.fim)}`
    : periodoImpressao.inicio
      ? `A partir de ${formatarDataBr(periodoImpressao.inicio)}`
      : periodoImpressao.fim
        ? `Até ${formatarDataBr(periodoImpressao.fim)}`
        : 'Todas as ordens planejadas'

  function handleImprimir(periodo) {
    deveImprimirRef.current = true
    setPeriodoImpressao(periodo)
    setImprimindo(false)
  }

  function abrirDetalheDaFila(card) {
    setDetalhe({ card, extra: null })
  }

  function abrirDetalhePlanejado(item) {
    const vivo = cardVivoPorOperacao.get(item.idOperacaoOrdem)
    const extra = (
      <>
        <div className="detalhes__linha">
          <dt className="detalhes__rotulo">Data planejada</dt>
          <dd>{formatarDataBr(item.data)}</dd>
        </div>
        <div className="detalhes__linha">
          <dt className="detalhes__rotulo">Planejado em</dt>
          <dd>{new Date(item.criadoEm).toLocaleString('pt-BR')}</dd>
        </div>
      </>
    )
    // Sem card vivo (ainda carregando, ou a operacao saiu do quadro por algum motivo), usa
    // so o retrato salvo — o modal esconde sozinho as linhas de producao que faltarem.
    // `materiais` so existe no retrato (ver /api/planejamento, server/materiais.js) — o card
    // vivo vem do kanban, que nao explode a BOM. Sem isto o modal buscaria de novo por api,
    // em vez de reaproveitar o que /api/planejamento ja calculou.
    // `planejamentoId` e o `id` do REGISTRO de planejamento (nao o idOperacaoOrdem) — e o que
    // moverDetalhePlanejado usa pra reagendar; card.id nao serve pois some quando `vivo` existe.
    setDetalhe({ card: { ...(vivo ?? item), materiais: item.materiais }, extra, planejamentoId: item.id, data: item.data })
  }

  // "Mudar programação" dentro do modal de detalhes — mesma chamada do drag-and-drop
  // (soltarEmDia), so que disparada pelo formulario do modal em vez de um drop.
  async function moverDetalhePlanejado(id, novaData) {
    try {
      const atualizado = await api.moverPlanejado(id, novaData)
      setPlano((p) => p.map((x) => (x.id === id ? atualizado : x)))
      setDetalhe(null)
    } catch (e) {
      setErro(e.message)
    }
  }

  // Clicar numa ordem dentro do modal do dia inteiro troca pro modal de detalhe daquela
  // ordem especifica (fecha o do dia, abre o da ordem) — os dois nunca ficam abertos juntos.
  function abrirItemDoDia(item) {
    setDiaDetalhe(null)
    abrirDetalhePlanejado(item)
  }

  function mudarMes(delta) {
    setMesAtual(({ ano, mes }) => {
      const d = new Date(ano, mes + delta, 1)
      return { ano: d.getFullYear(), mes: d.getMonth() }
    })
  }

  function irParaHoje() {
    setMesAtual({ ano: hoje.getFullYear(), mes: hoje.getMonth() })
  }

  async function soltarEmDia(chave) {
    const alvo = arrastando
    setArrastando(null)
    setDiaSobre(null)
    if (!alvo) return

    if (alvo.tipo === 'fila') {
      const c = alvo.card
      try {
        const novo = await api.agendar({
          idOrdem: c.idOrdem,
          idOperacaoOrdem: c.idOperacaoOrdem,
          nomeOrdem: c.nomeOrdem,
          pedido: c.pedido,
          idPedido: c.idPedido,
          idProduto: c.idProduto,
          produto: c.produto,
          codigoProduto: c.codigoProduto,
          quantidade: c.quantidade,
          unidadeMedida: c.unidadeMedida,
          valorTotal: c.valorTotal,
          data: chave,
        })
        setPlano((p) => [...p, novo])
      } catch (e) {
        setErro(e.message)
      }
    } else {
      const item = alvo.item
      if (item.data === chave) return
      try {
        const atualizado = await api.moverPlanejado(item.id, chave)
        setPlano((p) => p.map((x) => (x.id === item.id ? atualizado : x)))
      } catch (e) {
        setErro(e.message)
      }
    }
  }

  async function soltarNaFila() {
    const alvo = arrastando
    setArrastando(null)
    setDiaSobre(null)
    if (alvo?.tipo !== 'planejado') return
    try {
      await api.removerPlanejado(alvo.item.id)
      setPlano((p) => p.filter((x) => x.id !== alvo.item.id))
    } catch (e) {
      setErro(e.message)
    }
  }

  async function removerCard(item, evento) {
    evento.stopPropagation()
    try {
      await api.removerPlanejado(item.id)
      setPlano((p) => p.filter((x) => x.id !== item.id))
    } catch (e) {
      setErro(e.message)
    }
  }

  // Pede pro servidor (ver server/ia.js) uma sugestao de quais ordens do backlog agendar
  // pra atender o objetivo em texto livre — NUNCA agenda nada sozinha, so devolve um
  // rascunho pro ModalSugestaoIA mostrar. objetivo/periodo vem do ModalGerarSugestao.
  async function gerarSugestao({ objetivo, dataInicio, dataFim }) {
    setSugerindo(true)
    setErro(null)
    try {
      const resultado = await api.sugerirPlanejamento({ objetivo, dataInicio, dataFim })
      setSugestaoIA(resultado)
      setPedindoSugestao(false)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSugerindo(false)
    }
  }

  // Agenda de verdade so as sugestoes que o usuario marcou no modal, uma de cada vez (nao
  // em paralelo — cada agendar() explode a lista de materiais do produto no servidor, e
  // varias chamadas simultaneas martelariam o Nomus, ver server/materiais.js).
  async function aplicarSugestoesIA(selecionadas) {
    setAplicandoSugestao(true)
    try {
      for (const s of selecionadas) {
        const novo = await api.agendar({
          idOrdem: s.idOrdem,
          idOperacaoOrdem: s.idOperacaoOrdem,
          nomeOrdem: s.nomeOrdem,
          pedido: s.pedido,
          idPedido: s.idPedido,
          idProduto: s.idProduto,
          produto: s.produto,
          codigoProduto: s.codigoProduto,
          quantidade: s.quantidade,
          unidadeMedida: s.unidadeMedida,
          valorTotal: s.valorTotal,
          data: s.data,
        })
        setPlano((p) => [...p, novo])
      }
      setSugestaoIA(null)
    } catch (e) {
      setErro(e.message)
    } finally {
      setAplicandoSugestao(false)
    }
  }

  return (
    <main className="planejamento">
      <div className="planejamento__topo">
        <div>
          <h1 className="planejamento__titulo">PLANEJAMENTO DA PRODUÇÃO</h1>
          <p className="planejamento__subtitulo">
            Arraste as ordens da fila para o dia em que devem começar a ser produzidas.
          </p>
        </div>
        <div className="planejamento__navegacao">
          <button className="botao botao--neutro botao--pequeno" onClick={() => mudarMes(-1)}>
            ‹
          </button>
          <span className="planejamento__mes">
            {NOMES_MES[mesAtual.mes]} {mesAtual.ano}
          </span>
          <button className="botao botao--neutro botao--pequeno" onClick={() => mudarMes(1)}>
            ›
          </button>
          <button className="botao botao--neutro botao--pequeno" onClick={irParaHoje}>
            Hoje
          </button>
          <button className="botao botao--neutro botao--pequeno" onClick={carregar} disabled={carregando}>
            {carregando ? 'Atualizando...' : 'Atualizar'}
          </button>
          <button className="botao botao--neutro botao--pequeno" onClick={() => setImprimindo(true)}>
            Imprimir relatório
          </button>
          <button className="botao botao--iniciar botao--pequeno" onClick={() => setPedindoSugestao(true)}>
            Gerar sugestão com IA
          </button>
        </div>
      </div>

      {erro && (
        <p className="aviso aviso--erro" role="alert">
          {erro}
        </p>
      )}

      <div className="planejamento__busca-agendada">
        <input
          className="modal__campo planejamento__busca-agendada-campo"
          type="text"
          placeholder="Buscar OS já agendada no calendário..."
          value={buscaAgendada}
          onChange={(e) => setBuscaAgendada(e.target.value)}
        />
        {buscaAgendada.trim() && (
          <div className="planejamento__busca-agendada-resultados">
            {resultadosAgendados.length === 0 ? (
              <p className="planejamento__busca-agendada-vazio">
                Nenhuma ordem já agendada bate com isso — talvez ainda esteja na fila "Aguardando 1º processo".
              </p>
            ) : (
              resultadosAgendados.map((item) => (
                <button
                  key={item.id}
                  className="planejamento__busca-agendada-item"
                  onClick={() => irParaAgendado(item)}
                >
                  <strong>{item.nomeOrdem}</strong>
                  <span>{formatarDataBr(item.data)}</span>
                  {item.produto && <small>{item.produto}</small>}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="planejamento__corpo">
        <aside
          className={`planejamento__fila ${arrastando?.tipo === 'planejado' ? 'planejamento__fila--alvo' : ''}`}
          onDragOver={(e) => {
            if (arrastando?.tipo === 'planejado') e.preventDefault()
          }}
          onDrop={soltarNaFila}
        >
          <h2 className="planejamento__fila-titulo">
            Aguardando 1º processo <span className="coluna__contador">{fila.length}</span>
          </h2>
          <input
            className="planejamento__busca"
            type="text"
            placeholder="Buscar OS, pedido ou produto..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {quadro?.atualizadoEm && (
            // Hora real da ultima busca no Nomus (ver server/index.js,
            // dataDeAtualizacaoDoQuadro) — se estiver "atrasada", o dado pode estar
            // incompleto (ex.: ordem criada recem-agora ainda nao entrou no cache).
            <p className="planejamento__fila-atualizado">
              Atualizado às {new Date(quadro.atualizadoEm).toLocaleTimeString('pt-BR')}
            </p>
          )}
          <div className="planejamento__fila-lista">
            {!quadro && <p className="coluna__vazia">Carregando...</p>}
            {quadro && fila.length === 0 && <p className="coluna__vazia">Nada aqui</p>}
            {fila.map((c) => (
              <article
                key={`${c.idOrdem}-${c.idOperacaoOrdem}`}
                // A fila e por definicao so ordens intocadas (ver kanban.js/filaAguardando)
                // — sempre "nao iniciado", sem precisar consultar o status ao vivo.
                className="planejamento-card planejamento-card--nao-iniciado"
                draggable
                onDragStart={() => setArrastando({ tipo: 'fila', card: c })}
                onDragEnd={() => setArrastando(null)}
                onClick={() => abrirDetalheDaFila(c)}
              >
                <h3 className="planejamento-card__os">{c.nomeOrdem}</h3>
                {c.pedido && <span className="ficha__pedido">{c.pedido}</span>}
                {c.produto && <p className="planejamento-card__produto">{c.produto}</p>}
                {c.valorTotal != null && (
                  <p className="planejamento-card__valor">{formatarMoedaBr(c.valorTotal)}</p>
                )}
              </article>
            ))}
          </div>
        </aside>

        <div className="planejamento__grade">
          {DIAS_SEMANA.map((d) => (
            <div className="planejamento__cabecalho-dia" key={d}>
              {d}
            </div>
          ))}
          {dias.map((dia) => {
            const chave = chaveData(dia)
            const doMes = dia.getMonth() === mesAtual.mes
            const itensDoDia = planoPorDia.get(chave) ?? []
            return (
              <div
                key={chave}
                className={[
                  'planejamento__dia',
                  !doMes && 'planejamento__dia--fora',
                  chave === chaveHoje && 'planejamento__dia--hoje',
                  diaSobre === chave && 'planejamento__dia--alvo',
                  diaEmDestaque === chave && 'planejamento__dia--destaque',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (diaSobre !== chave) setDiaSobre(chave)
                }}
                onDragLeave={() => setDiaSobre((atual) => (atual === chave ? null : atual))}
                onDrop={() => soltarEmDia(chave)}
                onClick={() => setDiaDetalhe(chave)}
              >
                <span className="planejamento__numero-dia">{dia.getDate()}</span>
                <div className="planejamento__dia-cards">
                  {itensDoDia.map((item) => (
                    <article
                      key={item.id}
                      className={`planejamento-card planejamento-card--mini ${classeDoCard(item)}`}
                      draggable
                      onDragStart={() => setArrastando({ tipo: 'planejado', item })}
                      onDragEnd={() => setArrastando(null)}
                      onClick={(e) => {
                        e.stopPropagation()
                        abrirDetalhePlanejado(item)
                      }}
                      title={`${item.nomeOrdem}${item.produto ? ' · ' + item.produto : ''}`}
                    >
                      <span className="planejamento-card__os">{item.nomeOrdem}</span>
                      <button
                        className="planejamento-card__remover"
                        onClick={(e) => removerCard(item, e)}
                        aria-label={`Remover ${item.nomeOrdem} do planejamento`}
                      >
                        ×
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <ModalDetalheCard
        card={detalhe?.card}
        agora={agora}
        extra={detalhe?.extra}
        mostrarValor
        dataPlanejada={detalhe?.data}
        onMudarDia={
          detalhe?.planejamentoId ? (novaData) => moverDetalhePlanejado(detalhe.planejamentoId, novaData) : undefined
        }
        onFechar={() => setDetalhe(null)}
      />
      <ModalDetalheDia
        data={diaDetalhe}
        itens={
          diaDetalhe
            ? (planoPorDia.get(diaDetalhe) ?? []).map((item) => ({ ...item, iniciado: statusIniciado(item) }))
            : []
        }
        onFechar={() => setDiaDetalhe(null)}
        onAbrirItem={abrirItemDoDia}
        onRemoverItem={removerCard}
      />
      <RelatorioImpressao itens={itensRelatorio} periodoLabel={periodoLabel} />
      {imprimindo && <ModalImprimir onImprimir={handleImprimir} onFechar={() => setImprimindo(false)} />}
      {pedindoSugestao && (
        <ModalGerarSugestao
          gerando={sugerindo}
          onGerar={gerarSugestao}
          onFechar={() => setPedindoSugestao(false)}
        />
      )}
      {sugestaoIA && (
        <ModalSugestaoIA
          sugestao={sugestaoIA}
          aplicando={aplicandoSugestao}
          onAplicar={aplicarSugestoesIA}
          onFechar={() => setSugestaoIA(null)}
        />
      )}
    </main>
  )
}
