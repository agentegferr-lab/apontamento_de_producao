import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { formatarDuracao, parseLocalISO } from '../tempo.js'

const ROTULO = {
  EM_PRODUCAO: 'EM PRODUÇÃO',
  PARADO: 'PARADO',
  AGUARDANDO: 'AGUARDANDO',
  CONCLUIDO: 'CONCLUÍDO',
}

const CLASSE = {
  EM_PRODUCAO: 'etiqueta--producao',
  PARADO: 'etiqueta--parado',
  AGUARDANDO: 'etiqueta--aguardando',
  CONCLUIDO: 'etiqueta--concluido',
}

const FILTROS = [
  { valor: 'todas', texto: 'Todas as ordens' },
  { valor: 'EM_PRODUCAO', texto: 'Em produção' },
  { valor: 'PARADO', texto: 'Paradas' },
  { valor: 'AGUARDANDO', texto: 'Aguardando' },
  { valor: 'CONCLUIDO', texto: 'Concluídas' },
]

/**
 * Cronometro do card. Produzindo, conta desde o inicio; parado, conta ha quanto tempo esta
 * parado — que e o numero que interessa a quem olha o quadro. Nas demais situacoes mostra o
 * tempo ja gravado no Nomus.
 */
function tempoDoCard(card, agora) {
  if ((card.status === 'EM_PRODUCAO' || card.status === 'PARADO') && card.dataHoraInicial) {
    const inicio = parseLocalISO(card.dataHoraInicial)
    if (inicio) return formatarDuracao(agora - inicio)
  }
  return card.tempoGravadoMs > 0 ? formatarDuracao(card.tempoGravadoMs) : '-'
}

export default function TelaKanban({ recarregarEm }) {
  const [quadro, setQuadro] = useState(null)
  const [erro, setErro] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [filtro, setFiltro] = useState('todas')
  const [agora, setAgora] = useState(() => new Date())
  const [atualizadoEm, setAtualizadoEm] = useState(null)

  async function carregar() {
    setCarregando(true)
    try {
      const dados = await api.kanban()
      setQuadro(dados)
      setAtualizadoEm(new Date())
      setErro(null)
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [recarregarEm])

  // Um tick pra tela toda; cada card calcula seu proprio decorrido.
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const colunas = useMemo(() => {
    if (!quadro) return []
    if (filtro === 'todas') return quadro.colunas
    return quadro.colunas.map((c) => ({ ...c, cards: c.cards.filter((k) => k.status === filtro) }))
  }, [quadro, filtro])

  const total = colunas.reduce((s, c) => s + c.cards.length, 0)

  // KPIs do topo: sempre contam TODAS as ordens, independente do filtro selecionado —
  // sao um resumo geral do quadro, nao do que esta visivel no momento.
  const contagem = useMemo(() => {
    const c = { EM_PRODUCAO: 0, AGUARDANDO: 0, PARADO: 0 }
    if (!quadro) return c
    for (const coluna of quadro.colunas) {
      for (const card of coluna.cards) {
        if (card.status in c) c[card.status] += 1
      }
    }
    return c
  }, [quadro])

  return (
    <main className="kanban">
      <div className="kanban__topo">
        <div>
          <h1 className="kanban__titulo">ACOMPANHAMENTO DA PRODUÇÃO</h1>
          <p className="kanban__subtitulo">Acompanhe o status das ordens em cada etapa do processo.</p>
        </div>

        <div className="kanban__kpis">
          <div className="kpi kpi--producao">
            <span className="kpi__valor">{contagem.EM_PRODUCAO}</span>
            <span className="kpi__rotulo">Em produção</span>
          </div>
          <div className="kpi kpi--aguardando">
            <span className="kpi__valor">{contagem.AGUARDANDO}</span>
            <span className="kpi__rotulo">Aguardando</span>
          </div>
          <div className="kpi kpi--parado">
            <span className="kpi__valor">{contagem.PARADO}</span>
            <span className="kpi__rotulo">Pausada</span>
          </div>
          <div className="kpi kpi--fila">
            <span className="kpi__valor">{quadro?.filaAguardando?.length ?? 0}</span>
            <span className="kpi__rotulo">Aguardando 1º processo</span>
          </div>
        </div>

        <div className="kanban__controles">
          <select className="seletor" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            {FILTROS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.texto}
              </option>
            ))}
          </select>
          <button className="botao botao--neutro botao--pequeno" onClick={carregar} disabled={carregando}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {carregando ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {erro && (
        <p className="aviso aviso--erro" role="alert">
          {erro}
        </p>
      )}

      {!quadro && !erro && <p className="kanban__vazio">Carregando o quadro...</p>}

      {quadro && total === 0 && (
        <p className="kanban__vazio">Nenhuma ordem para este filtro.</p>
      )}

      {quadro && total > 0 && (
        <div className="kanban__colunas">
          {colunas.map((coluna) => (
            <section className="coluna" key={coluna.nome}>
              <header className="coluna__topo">
                <h2 className="coluna__nome">{coluna.nome}</h2>
                <span className="coluna__contador">{coluna.cards.length}</span>
              </header>
              <div className="coluna__cards">
                {coluna.cards.map((card) => (
                  <article className="ficha" key={`${card.idOrdem}-${card.idOperacaoOrdem}`}>
                    <div className="ficha__cabecalho">
                      <h3 className="ficha__os">{card.nomeOrdem}</h3>
                      {/* Sem pedido quando a API nao o expoe — ver server/pedidos.js.
                          card.pedido ja vem como "PD 01196", sem precisar do prefixo aqui. */}
                      {card.pedido && <span className="ficha__pedido">{card.pedido}</span>}
                    </div>
                    {card.produto && <p className="ficha__produto">{card.produto}</p>}
                    <p className="ficha__descricao">{card.descricao || 'Sem descrição'}</p>
                    <p className="ficha__etapas">
                      Etapa {card.operacao} · {card.etapasConcluidas}/{card.totalEtapas} concluídas
                      {card.operadorAtual ? ` · ${card.operadorAtual}` : ''}
                    </p>
                    {card.motivoParada && <p className="ficha__parada">⏸ {card.motivoParada}</p>}
                    <div className="ficha__rodape">
                      <span className={`etiqueta ${CLASSE[card.status]}`}>{ROTULO[card.status]}</span>
                      <span className="ficha__tempo">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" strokeLinecap="round" />
                        </svg>
                        {tempoDoCard(card, agora)}
                      </span>
                    </div>
                  </article>
                ))}
                {coluna.cards.length === 0 && <p className="coluna__vazia">—</p>}
              </div>
            </section>
          ))}
        </div>
      )}

      {atualizadoEm && (
        <p className="kanban__rodape">
          Última atualização: {atualizadoEm.toLocaleDateString('pt-BR')}{' '}
          {atualizadoEm.toLocaleTimeString('pt-BR')}
        </p>
      )}
    </main>
  )
}
