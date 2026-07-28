import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { formatarNumeroBr } from '../numero.js'
import {
  intervaloDoPeriodo,
  navegarPeriodo,
  formatarDuracao,
  gerarCsvRelatorioProducao,
  quantidadePrincipal,
  calcularTendencia,
  ultimosDias,
  serieDiariaPorCentro,
  paginar,
  corDoCentro,
} from '../producaoCampos.js'

const MODOS_PERIODO = [
  { valor: 'dia', texto: 'Dia' },
  { valor: 'semana', texto: 'Semana' },
  { valor: 'mes', texto: 'Mês' },
]

const TAMANHO_PAGINA = 10
const DIAS_SPARKLINE = 7

function chaveDoDia(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Unidades comuns do Nomus abreviadas ("METRO QUADRADO" -> "m²") — o nome por extenso e o que
// mais ocupava espaco nos cards/tabela, a ponto de estourar a largura. Unidade fora dessa
// lista (nao ha uma lista fixa/completa vinda do Nomus) cai no title-case de antes.
const ABREVIACOES_UNIDADE = {
  'METRO QUADRADO': 'm²',
  'METRO CUBICO': 'm³',
  METRO: 'm',
  QUILOGRAMA: 'kg',
  GRAMA: 'g',
  TONELADA: 't',
  LITRO: 'l',
  UNIDADE: 'un',
  PECA: 'pç',
  CAIXA: 'cx',
}

function formatarUnidade(unidade) {
  if (!unidade) return ''
  const chave = unidade.trim().toUpperCase()
  if (ABREVIACOES_UNIDADE[chave]) return ABREVIACOES_UNIDADE[chave]
  return unidade.charAt(0) + unidade.slice(1).toLowerCase()
}

function pluralizar(n, singular, plural) {
  return n === 1 ? singular : plural
}

const IconeBarrasIndicador = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 20V10M12 20V4M20 20v-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconeChevronBaixo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Linha de tendencia minúscula dentro do card — decorativa (mistura unidades), so pra dar
 * uma ideia visual dos ultimos dias. O valor exato/por unidade mora no numero grande do card. */
function Sparkline({ valores, cor }) {
  const largura = 88
  const altura = 30
  const max = Math.max(...valores, 0)
  const min = Math.min(...valores, 0)
  const amplitude = max - min || 1
  const pontos = valores
    .map((v, i) => {
      const x = valores.length > 1 ? (i / (valores.length - 1)) * largura : largura / 2
      const y = altura - 3 - ((v - min) / amplitude) * (altura - 6)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${largura} ${altura}`}
      className="indicador-producao__sparkline"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={pontos} fill="none" stroke={cor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {valores.length > 0 && (
        <circle
          cx={largura}
          cy={(altura - 3 - ((valores[valores.length - 1] - min) / amplitude) * (altura - 6)).toFixed(1)}
          r="2.5"
          fill={cor}
        />
      )}
    </svg>
  )
}

function BadgeTendencia({ tendencia }) {
  if (tendencia.direcao === 'estavel') {
    return <span className="tendencia-badge tendencia-badge--estavel">Estável</span>
  }
  if (tendencia.direcao === 'novo') {
    return <span className="tendencia-badge tendencia-badge--alta">Novo</span>
  }
  const sinal = tendencia.direcao === 'alta' ? '+' : ''
  return (
    <span className={`tendencia-badge tendencia-badge--${tendencia.direcao}`}>
      {sinal}
      {formatarNumeroBr(tendencia.percentual)}%
    </span>
  )
}

/** Barras simples em CSS/flex (sem lib de grafico) — poucos centros, poucos pontos, nao vale
 * puxar uma dependencia nova so pra isso. */
function GraficoBarras({ itens, unidade }) {
  const max = Math.max(...itens.map((i) => i.principal.total), 1)
  return (
    <div className="grafico-barras">
      {itens.map((item) => (
        <div className="grafico-barras__coluna" key={item.centro}>
          <span className="grafico-barras__valor">
            {formatarNumeroBr(item.principal.total)} {formatarUnidade(unidade)}
          </span>
          <div className="grafico-barras__trilho">
            <div
              className="grafico-barras__barra"
              style={{ height: `${Math.max(4, (item.principal.total / max) * 100)}%`, background: item.cor }}
            />
          </div>
          <span className="grafico-barras__rotulo">{item.centro}</span>
        </div>
      ))}
    </div>
  )
}

/** Rosca via SVG (stroke-dasharray acumulado) — mesma logica, sem lib de grafico. */
function GraficoDonut({ itens, unidade }) {
  const total = itens.reduce((soma, i) => soma + i.principal.total, 0)
  const raio = 58
  const circunferencia = 2 * Math.PI * raio
  let acumulado = 0

  return (
    <div className="grafico-donut-wrap">
      <svg viewBox="0 0 160 160" className="grafico-donut" role="img" aria-label={`Distribuição por centro: ${formatarNumeroBr(total)} ${formatarUnidade(unidade)} no total`}>
        <g transform="translate(80,80) rotate(-90)">
          <circle r={raio} fill="none" stroke="var(--linha)" strokeWidth="20" />
          {itens.map((item) => {
            const fracao = total > 0 ? item.principal.total / total : 0
            const dash = Math.max(0, fracao * circunferencia - (itens.length > 1 ? 2 : 0))
            const offset = -acumulado * circunferencia
            acumulado += fracao
            return (
              <circle
                key={item.centro}
                r={raio}
                fill="none"
                stroke={item.cor}
                strokeWidth="20"
                strokeDasharray={`${dash} ${circunferencia - dash}`}
                strokeDashoffset={offset}
                strokeLinecap="round"
              />
            )
          })}
        </g>
        <text x="80" y="76" textAnchor="middle" className="grafico-donut__valor">
          {formatarNumeroBr(total)}
        </text>
        <text x="80" y="94" textAnchor="middle" className="grafico-donut__legenda-central">
          {formatarUnidade(unidade)} totais
        </text>
      </svg>
      <ul className="grafico-donut__legenda">
        {itens.map((item) => (
          <li key={item.centro}>
            <span className="grafico-donut__marcador" style={{ background: item.cor }} />
            <span className="grafico-donut__legenda-nome">{item.centro}</span>
            <span className="grafico-donut__legenda-percentual">
              {total > 0 ? formatarNumeroBr((item.principal.total / total) * 100) : '0'}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Relatorio de producao por centro de trabalho (Corte, Pintura...) num periodo — ver
 * server/relatorioProducao.js. Sem senha (so leitura, mesmo padrao do Relatorio de Entregas).
 */
export default function TelaRelatorioProducao() {
  const [modo, setModo] = useState('dia')
  const [referencia, setReferencia] = useState(() => new Date())
  const [dados, setDados] = useState(null)
  const [dadosAnterior, setDadosAnterior] = useState(null)
  const [dadosSpark, setDadosSpark] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  const [busca, setBusca] = useState('')
  const [filtroCentro, setFiltroCentro] = useState('')
  const [filtroEtapa, setFiltroEtapa] = useState('')
  const [filtroColaborador, setFiltroColaborador] = useState('')
  const [pagina, setPagina] = useState(1)

  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [exportAberto, setExportAberto] = useState(false)

  const dataOcultaRef = useRef(null)
  const filtrosPainelRef = useRef(null)
  const filtrosBotaoTopoRef = useRef(null)
  const filtrosBotaoListaRef = useRef(null)
  const exportBotaoRef = useRef(null)
  const exportPainelRef = useRef(null)

  const periodo = useMemo(() => intervaloDoPeriodo(modo, referencia), [modo, referencia])
  const diasSparkChaves = useMemo(() => ultimosDias(periodo.fim, DIAS_SPARKLINE), [periodo.fim])

  async function carregarTudo() {
    setCarregando(true)
    try {
      const periodoAnterior = intervaloDoPeriodo(modo, navegarPeriodo(modo, referencia, -1))
      const diasSpark = ultimosDias(periodo.fim, DIAS_SPARKLINE)
      const [atual, anterior, spark] = await Promise.all([
        api.relatorioProducao(periodo.inicio, periodo.fim),
        api.relatorioProducao(periodoAnterior.inicio, periodoAnterior.fim),
        api.relatorioProducao(diasSpark[0], periodo.fim),
      ])
      setDados(atual)
      setDadosAnterior(anterior)
      setDadosSpark(spark)
      setErro(null)
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregarTudo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo.inicio, periodo.fim])

  // Filtros e pagina nao sobrevivem a troca de periodo — um centro/etapa que so existia no
  // periodo anterior deixaria a listagem escondendo tudo, sem nenhuma pista do porque.
  useEffect(() => {
    setFiltroCentro('')
    setFiltroEtapa('')
    setFiltroColaborador('')
  }, [periodo.inicio, periodo.fim])

  useEffect(() => {
    setPagina(1)
  }, [periodo.inicio, periodo.fim, busca, filtroCentro, filtroEtapa, filtroColaborador])

  useEffect(() => {
    if (!filtrosAbertos) return
    function aoClicarFora(e) {
      if (
        filtrosPainelRef.current?.contains(e.target) ||
        filtrosBotaoTopoRef.current?.contains(e.target) ||
        filtrosBotaoListaRef.current?.contains(e.target)
      )
        return
      setFiltrosAbertos(false)
    }
    function aoTeclar(e) {
      if (e.key === 'Escape') setFiltrosAbertos(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [filtrosAbertos])

  useEffect(() => {
    if (!exportAberto) return
    function aoClicarFora(e) {
      if (exportPainelRef.current?.contains(e.target) || exportBotaoRef.current?.contains(e.target)) return
      setExportAberto(false)
    }
    function aoTeclar(e) {
      if (e.key === 'Escape') setExportAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [exportAberto])

  function abrirSeletorDeData() {
    const el = dataOcultaRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.focus()
  }

  // Um cartao por centro: numero principal (unidade de maior total), tendencia contra o
  // periodo equivalente anterior (mesmo modo — ex.: dia contra o dia anterior) e um
  // "sparkline" com os ultimos 7 dias, sempre na mesma janela, independente do modo escolhido.
  const cartoes = useMemo(() => {
    if (!dados) return []
    const anteriorPorCentro = new Map((dadosAnterior?.porCentro ?? []).map((c) => [c.centro, c]))
    return dados.porCentro.map((c, i) => {
      const principal = quantidadePrincipal(c.quantidades)
      const anteriorCentro = anteriorPorCentro.get(c.centro)
      const anteriorPrincipal = anteriorCentro ? quantidadePrincipal(anteriorCentro.quantidades) : null
      const tendencia = calcularTendencia(principal?.total ?? 0, anteriorPrincipal?.total ?? 0)
      const serie = dadosSpark ? serieDiariaPorCentro(dadosSpark.detalhado, c.centro, diasSparkChaves) : diasSparkChaves.map(() => 0)
      return { ...c, cor: corDoCentro(i), principal, tendencia, serie }
    })
  }, [dados, dadosAnterior, dadosSpark, diasSparkChaves])

  // Barras/rosca so fazem sentido somando a MESMA unidade — pega a mais comum entre os
  // centros do periodo e deixa de fora quem produziu numa unidade diferente (raro na pratica).
  const dadosGrafico = useMemo(() => {
    const comPrincipal = cartoes.filter((c) => c.principal)
    if (comPrincipal.length === 0) return { itens: [], unidade: null, excluidos: 0 }
    const contagem = new Map()
    for (const c of comPrincipal) contagem.set(c.principal.unidade, (contagem.get(c.principal.unidade) ?? 0) + 1)
    const unidadeDominante = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const itens = comPrincipal.filter((c) => c.principal.unidade === unidadeDominante)
    return { itens, unidade: unidadeDominante, excluidos: comPrincipal.length - itens.length }
  }, [cartoes])

  const etapasDisponiveis = useMemo(
    () => [...new Set((dados?.detalhado ?? []).map((d) => d.descricaoEtapa).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [dados],
  )
  const colaboradoresDisponiveis = useMemo(
    () => [...new Set((dados?.detalhado ?? []).map((d) => d.funcionario).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [dados],
  )

  const detalhesFiltrados = useMemo(() => {
    if (!dados) return []
    const alvo = busca.trim().toLowerCase()
    return dados.detalhado.filter((d) => {
      if (filtroCentro && d.centro !== filtroCentro) return false
      if (filtroEtapa && d.descricaoEtapa !== filtroEtapa) return false
      if (filtroColaborador && d.funcionario !== filtroColaborador) return false
      if (!alvo) return true
      return (
        (d.nomeOrdem ?? '').toLowerCase().includes(alvo) ||
        (d.funcionario ?? '').toLowerCase().includes(alvo) ||
        (d.descricaoEtapa ?? '').toLowerCase().includes(alvo)
      )
    })
  }, [dados, busca, filtroCentro, filtroEtapa, filtroColaborador])

  const { itens: paginaAtual, totalPaginas } = useMemo(
    () => paginar(detalhesFiltrados, pagina, TAMANHO_PAGINA),
    [detalhesFiltrados, pagina],
  )

  // PDF/CSV de verdade pra baixar (nao e window.print()) — o servidor monta o arquivo (ver
  // server/relatorioProducaoPdf.js) com os MESMOS filtros de periodo ja carregados na tela.
  function baixarPdf() {
    const params = new URLSearchParams({ inicio: periodo.inicio, fim: periodo.fim, rotulo: periodo.rotulo })
    const a = document.createElement('a')
    a.href = `/api/relatorio-producao/pdf?${params.toString()}`
    a.click()
  }

  function exportarCsv() {
    const csv = gerarCsvRelatorioProducao(detalhesFiltrados)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `producao-${periodo.inicio}-a-${periodo.fim}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const carregandoPrimeiraVez = carregando && !dados
  const quantidadeFiltrosOcultos = filtroColaborador ? 1 : 0

  return (
    <main className="relatorio-producao">
      <div className="relatorio-producao__topo">
        <div>
          <h1 className="relatorio-producao__titulo">Relatório de Produção</h1>
          <p className="relatorio-producao__subtitulo">
            Visão consolidada de produtividade, volumes e apontamentos operacionais.
          </p>
        </div>
      </div>

      <div className="relatorio-producao__controles">
        <div className="segmentado" role="group" aria-label="Período">
          {MODOS_PERIODO.map((m) => (
            <button
              key={m.valor}
              type="button"
              className={`segmentado__item ${modo === m.valor ? 'segmentado__item--ativo' : ''}`}
              aria-pressed={modo === m.valor}
              onClick={() => setModo(m.valor)}
            >
              {m.texto}
            </button>
          ))}
        </div>
        <div className="relatorio-producao__navegacao">
          <button
            type="button"
            className="botao botao--neutro botao--pequeno botao--icone"
            aria-label="Período anterior"
            onClick={() => setReferencia((r) => navegarPeriodo(modo, r, -1))}
          >
            ‹
          </button>
          <span className="periodo-rotulo">{periodo.rotulo}</span>
          <button
            type="button"
            className="botao botao--neutro botao--pequeno botao--icone"
            aria-label="Próximo período"
            onClick={() => setReferencia((r) => navegarPeriodo(modo, r, 1))}
          >
            ›
          </button>
          <button type="button" className="botao botao--neutro botao--pequeno" onClick={() => setReferencia(new Date())}>
            Hoje
          </button>
          <button
            type="button"
            className="botao botao--neutro botao--pequeno botao--icone"
            aria-label="Escolher uma data"
            onClick={abrirSeletorDeData}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 9h18M8 3v4M16 3v4" />
            </svg>
          </button>
          <input
            ref={dataOcultaRef}
            type="date"
            className="data-oculta"
            aria-hidden="true"
            tabIndex={-1}
            value={chaveDoDia(referencia)}
            onChange={(e) => e.target.value && setReferencia(new Date(`${e.target.value}T00:00:00`))}
          />
          <button
            type="button"
            className="botao botao--neutro botao--pequeno"
            onClick={carregarTudo}
            disabled={carregando}
          >
            {carregando ? 'Atualizando...' : 'Atualizar'}
          </button>
          <button
            ref={filtrosBotaoTopoRef}
            type="button"
            className={`botao botao--neutro botao--pequeno ${filtroColaborador ? 'botao--ativo' : ''}`}
            aria-expanded={filtrosAbertos}
            aria-haspopup="dialog"
            onClick={() => setFiltrosAbertos((a) => !a)}
          >
            Filtros{quantidadeFiltrosOcultos > 0 ? ` (${quantidadeFiltrosOcultos})` : ''}
          </button>
          <div className="dropdown-wrap">
            <button
              ref={exportBotaoRef}
              type="button"
              className="botao botao--amarelo botao--pequeno"
              aria-expanded={exportAberto}
              aria-haspopup="menu"
              onClick={() => setExportAberto((a) => !a)}
            >
              Exportar
              <IconeChevronBaixo />
            </button>
            {exportAberto && (
              <div ref={exportPainelRef} className="dropdown-lista" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="dropdown-item"
                  disabled={detalhesFiltrados.length === 0}
                  onClick={() => {
                    setExportAberto(false)
                    exportarCsv()
                  }}
                >
                  Exportar CSV
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="dropdown-item"
                  onClick={() => {
                    setExportAberto(false)
                    baixarPdf()
                  }}
                >
                  Baixar PDF
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {erro && (
        <p className="aviso aviso--erro" role="alert">
          {erro}
        </p>
      )}

      {carregandoPrimeiraVez && !erro && <p className="vazio">Carregando...</p>}

      {dados && (
        <>
          {cartoes.length === 0 ? (
            <p className="vazio">Nenhum apontamento registrado neste período.</p>
          ) : (
            <>
              <div className="relatorio-producao__indicadores">
                {cartoes.map((c) => (
                  <div className="indicador-producao" key={c.centro}>
                    <div className="indicador-producao__topo">
                      <span className="indicador-producao__icone" style={{ '--cor-centro': c.cor }}>
                        <IconeBarrasIndicador />
                      </span>
                      <span className="indicador-producao__titulo">{c.centro}</span>
                    </div>
                    <div className="indicador-producao__meio">
                      <span className="indicador-producao__valor">
                        {c.principal ? `${formatarNumeroBr(c.principal.total)} ${formatarUnidade(c.principal.unidade)}` : '—'}
                      </span>
                      <Sparkline valores={c.serie} cor={c.cor} />
                    </div>
                    <div className="indicador-producao__rodape">
                      <span className="indicador-producao__aux">
                        {c.ordens} {pluralizar(c.ordens, 'ordem', 'ordens')} · {formatarDuracao(c.tempoMs)}
                      </span>
                      <BadgeTendencia tendencia={c.tendencia} />
                    </div>
                  </div>
                ))}
              </div>

              {dadosGrafico.itens.length > 0 && (
                <div className="relatorio-producao__graficos">
                  <div className="painel-grafico">
                    <h2 className="painel-grafico__titulo">Produção por centro</h2>
                    <p className="painel-grafico__subtitulo">Comparativo do volume produzido no período</p>
                    <div className="painel-grafico__legenda">
                      {dadosGrafico.itens.map((item) => (
                        <span className="painel-grafico__legenda-item" key={item.centro}>
                          <span className="painel-grafico__marcador" style={{ background: item.cor }} />
                          {item.centro}
                        </span>
                      ))}
                    </div>
                    <GraficoBarras itens={dadosGrafico.itens} unidade={dadosGrafico.unidade} />
                  </div>
                  <div className="painel-grafico">
                    <h2 className="painel-grafico__titulo">Distribuição do período</h2>
                    <p className="painel-grafico__subtitulo">Participação por centro de trabalho</p>
                    <GraficoDonut itens={dadosGrafico.itens} unidade={dadosGrafico.unidade} />
                  </div>
                </div>
              )}
            </>
          )}

          <div className="lista-cabecalho">
            <div>
              <h2 className="lista-titulo">Apontamentos do período</h2>
              <p className="lista-contagem">
                {detalhesFiltrados.length === 0
                  ? 'Nenhum registro encontrado'
                  : `${detalhesFiltrados.length} ${pluralizar(detalhesFiltrados.length, 'registro encontrado', 'registros encontrados')}`}
              </p>
            </div>
            <div className="lista-acoes">
              <div className="busca-wrap">
                <svg className="busca-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="search"
                  className="busca"
                  placeholder="Buscar por OS, etapa ou colaborador..."
                  aria-label="Buscar por OS, etapa ou colaborador"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <select
                className="seletor"
                aria-label="Filtrar por centro de trabalho"
                value={filtroCentro}
                onChange={(e) => setFiltroCentro(e.target.value)}
              >
                <option value="">Todos os centros</option>
                {dados.porCentro.map((c) => (
                  <option key={c.centro} value={c.centro}>
                    {c.centro}
                  </option>
                ))}
              </select>
              <select
                className="seletor"
                aria-label="Filtrar por etapa"
                value={filtroEtapa}
                onChange={(e) => setFiltroEtapa(e.target.value)}
                disabled={etapasDisponiveis.length === 0}
              >
                <option value="">Etapa</option>
                {etapasDisponiveis.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <div className="dropdown-wrap">
                <button
                  ref={filtrosBotaoListaRef}
                  type="button"
                  className={`botao botao--neutro botao--pequeno ${filtroColaborador ? 'botao--ativo' : ''}`}
                  aria-expanded={filtrosAbertos}
                  aria-haspopup="dialog"
                  onClick={() => setFiltrosAbertos((a) => !a)}
                >
                  Mais filtros
                </button>
                {filtrosAbertos && (
                  <div ref={filtrosPainelRef} className="dropdown-lista dropdown-lista--formulario" role="dialog" aria-label="Mais filtros">
                    <label className="entregas__filtros-campo">
                      Colaborador
                      <select
                        className="seletor"
                        value={filtroColaborador}
                        onChange={(e) => setFiltroColaborador(e.target.value)}
                        disabled={colaboradoresDisponiveis.length === 0}
                      >
                        <option value="">Todos</option>
                        {colaboradoresDisponiveis.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    {filtroColaborador && (
                      <button
                        type="button"
                        className="botao botao--neutro botao--pequeno"
                        onClick={() => setFiltroColaborador('')}
                      >
                        Limpar filtro
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {detalhesFiltrados.length === 0 ? (
            <p className="vazio">Nenhum apontamento encontrado para os filtros selecionados.</p>
          ) : (
            <div className="tabela-wrap">
              <table className="relatorio-producao__tabela">
                <thead>
                  <tr>
                    <th>Data/hora</th>
                    <th>Centro</th>
                    <th>OS</th>
                    <th>Etapa</th>
                    <th className="col-numerica">Produção</th>
                    <th>Colaborador</th>
                    <th className="col-numerica">Duração</th>
                  </tr>
                </thead>
                <tbody>
                  {paginaAtual.map((d) => {
                    const indiceCentro = dados.porCentro.findIndex((c) => c.centro === d.centro)
                    const corCentro = corDoCentro(indiceCentro === -1 ? 0 : indiceCentro)
                    return (
                      <tr key={d.id}>
                        <td data-rotulo="Data/hora">{d.dataHoraFinal ?? '—'}</td>
                        <td data-rotulo="Centro">
                          <span className="pill-centro" style={{ '--cor-centro': corCentro }}>
                            {d.centro}
                          </span>
                        </td>
                        <td data-rotulo="OS">
                          <span className="os-destaque">{d.nomeOrdem ?? '—'}</span>
                        </td>
                        <td data-rotulo="Etapa">
                          {d.descricaoEtapa ? <span className="pill-neutro">{d.descricaoEtapa}</span> : '—'}
                        </td>
                        <td data-rotulo="Produção" className="col-numerica">
                          <strong>{d.quantidade != null ? `${formatarNumeroBr(d.quantidade)} ${formatarUnidade(d.unidadeMedida)}` : '—'}</strong>
                        </td>
                        <td data-rotulo="Colaborador">{d.funcionario ?? '—'}</td>
                        <td data-rotulo="Duração" className="col-numerica">
                          {formatarDuracao(d.duracaoMs)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="rodape">
            <span className="rodape-total">
              Mostrando {paginaAtual.length === 0 ? 0 : (pagina - 1) * TAMANHO_PAGINA + 1}–
              {(pagina - 1) * TAMANHO_PAGINA + paginaAtual.length} de {detalhesFiltrados.length}{' '}
              {pluralizar(detalhesFiltrados.length, 'registro', 'registros')}
            </span>
            {totalPaginas > 1 && (
              <div className="paginacao">
                <button
                  type="button"
                  className="botao botao--neutro botao--pequeno botao--icone"
                  aria-label="Página anterior"
                  disabled={pagina <= 1}
                  onClick={() => setPagina((p) => p - 1)}
                >
                  ‹
                </button>
                <span className="paginacao__pagina-atual">{pagina}</span>
                <button
                  type="button"
                  className="botao botao--neutro botao--pequeno botao--icone"
                  aria-label="Próxima página"
                  disabled={pagina >= totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  ›
                </button>
              </div>
            )}
          </div>

          {dados.atualizadoEm && (
            <p className="relatorio-producao__atualizado">
              Última atualização: {new Date(dados.atualizadoEm).toLocaleDateString('pt-BR')}{' '}
              {new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR')}
            </p>
          )}
        </>
      )}
    </main>
  )
}
