import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import ModalDetalheCard from './ModalDetalheCard.jsx'
import ModalDetalheDia from './ModalDetalheDia.jsx'
import { formatarNumeroBr } from '../numero.js'
import { agruparMaterial, formatarDataBr } from '../planejamentoCampos.js'

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
  const [modo, setModo] = useState('cards') // 'cards' | 'material'
  const [diaDetalhe, setDiaDetalhe] = useState(null) // chave do dia (AAAA-MM-DD) pro modal do dia inteiro

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

  const dias = useMemo(() => gerarGradeMes(mesAtual.ano, mesAtual.mes), [mesAtual])
  const chaveHoje = useMemo(() => chaveData(hoje), [hoje])

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
    setDetalhe({ card: vivo ?? item, extra })
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
          idProduto: c.idProduto,
          produto: c.produto,
          codigoProduto: c.codigoProduto,
          quantidade: c.quantidade,
          unidadeMedida: c.unidadeMedida,
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
          <button
            className={`botao botao--pequeno ${modo === 'material' ? 'botao--ativo' : 'botao--neutro'}`}
            onClick={() => setModo((m) => (m === 'cards' ? 'material' : 'cards'))}
          >
            {modo === 'material' ? 'Ver ordens' : 'Ver material do dia'}
          </button>
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
        </div>
      </div>

      {erro && (
        <p className="aviso aviso--erro" role="alert">
          {erro}
        </p>
      )}

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
          <div className="planejamento__fila-lista">
            {!quadro && <p className="coluna__vazia">Carregando...</p>}
            {quadro && fila.length === 0 && <p className="coluna__vazia">Nada aqui</p>}
            {fila.map((c) => (
              <article
                key={`${c.idOrdem}-${c.idOperacaoOrdem}`}
                className="planejamento-card"
                draggable
                onDragStart={() => setArrastando({ tipo: 'fila', card: c })}
                onDragEnd={() => setArrastando(null)}
                onClick={() => abrirDetalheDaFila(c)}
              >
                <h3 className="planejamento-card__os">{c.nomeOrdem}</h3>
                {c.pedido && <span className="ficha__pedido">{c.pedido}</span>}
                {c.produto && <p className="planejamento-card__produto">{c.produto}</p>}
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
                {modo === 'cards' ? (
                  <div className="planejamento__dia-cards">
                    {itensDoDia.map((item) => (
                      <article
                        key={item.id}
                        className="planejamento-card planejamento-card--mini"
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
                ) : (
                  <div className="planejamento__dia-material">
                    {agruparMaterial(itensDoDia).map((g) => (
                      <p
                        key={g.chave}
                        className="planejamento__material-linha"
                        title={`${g.produto} — ${formatarNumeroBr(g.quantidade)} ${g.unidadeMedida}`}
                      >
                        <span className="planejamento__material-qtd">{formatarNumeroBr(g.quantidade)}</span>
                        <span className="planejamento__material-nome">
                          {g.unidadeMedida} · {g.produto}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <ModalDetalheCard
        card={detalhe?.card}
        agora={agora}
        extra={detalhe?.extra}
        onFechar={() => setDetalhe(null)}
      />
      <ModalDetalheDia
        data={diaDetalhe}
        itens={diaDetalhe ? (planoPorDia.get(diaDetalhe) ?? []) : []}
        onFechar={() => setDiaDetalhe(null)}
        onAbrirItem={abrirItemDoDia}
        onRemoverItem={removerCard}
      />
    </main>
  )
}
