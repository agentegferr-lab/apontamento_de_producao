import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { formatarNumeroBr, formatarMoedaNumero } from '../numero.js'
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
  somarValorProduzido,
  metaDoPeriodo,
  progressoMeta,
  serieAcumuladaPorPeriodo,
  maximoRedondo,
  abreviarNumero,
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

/**
 * Linhas ACUMULADAS no periodo (SVG puro, sem lib de grafico): a linha sobe conforme o setor
 * produz e a meta e uma reta tracejada — passou da reta, a meta foi atingida. `series` e
 * [{ chave, nome, cor, pontos }] (pontos `null` = ainda no futuro, a linha para ali) e
 * `meta` e { valor, rotulo } ou null (so quando UM setor esta filtrado: com varios, as
 * unidades e metas nao sao comparaveis na mesma escala).
 */
function GraficoLinhas({ rotulos, series, meta, formatarY }) {
  const L = 640
  const A = 260
  const margem = { esq: 56, dir: 18, topo: 16, base: 28 }
  const maxDados = Math.max(0, ...series.flatMap((s) => s.pontos.filter((p) => p != null)))
  const topo = maximoRedondo(Math.max(maxDados, meta?.valor ?? 0))
  const n = rotulos.length
  const x = (i) => margem.esq + (n > 1 ? (i / (n - 1)) * (L - margem.esq - margem.dir) : (L - margem.esq - margem.dir) / 2)
  const y = (v) => margem.topo + (1 - v / topo) * (A - margem.topo - margem.base)
  const grade = [0, 0.25, 0.5, 0.75, 1].map((f) => f * topo)
  const passoRotulo = Math.max(1, Math.ceil(n / 12))

  return (
    <div className="grafico-linhas-wrap">
    <svg viewBox={`0 0 ${L} ${A}`} className="grafico-linhas" role="img" aria-label="Produção acumulada no período">
      {grade.map((v) => (
        <g key={v}>
          <line x1={margem.esq} x2={L - margem.dir} y1={y(v)} y2={y(v)} className="grafico-linhas__grade" />
          <text x={margem.esq - 8} y={y(v) + 4} textAnchor="end" className="grafico-linhas__eixo">
            {formatarY(v)}
          </text>
        </g>
      ))}
      {rotulos.map((r, i) =>
        i % passoRotulo === 0 ? (
          <text key={`${r}-${i}`} x={x(i)} y={A - 8} textAnchor="middle" className="grafico-linhas__eixo">
            {r}
          </text>
        ) : null,
      )}
      {meta && (
        <g>
          <line x1={margem.esq} x2={L - margem.dir} y1={y(meta.valor)} y2={y(meta.valor)} className="grafico-linhas__meta" />
          <text x={L - margem.dir} y={y(meta.valor) - 6} textAnchor="end" className="grafico-linhas__meta-rotulo">
            {meta.rotulo}
          </text>
        </g>
      )}
      {series.map((s) => {
        const trechos = []
        let atual = []
        s.pontos.forEach((p, i) => {
          if (p == null) {
            if (atual.length) trechos.push(atual)
            atual = []
          } else atual.push([x(i), y(p), p, rotulos[i]])
        })
        if (atual.length) trechos.push(atual)
        const ultimo = trechos.at(-1)?.at(-1)
        return (
          <g key={s.chave}>
            {trechos.map((t, k) => (
              <polyline
                key={k}
                points={t.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}
                fill="none"
                stroke={s.cor}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {trechos.flat().map(([px, py, valor, rotulo]) => (
              <circle key={`${px}`} cx={px} cy={py} r="7" fill="transparent">
                <title>{`${s.nome} · ${rotulo}: ${formatarY(valor)}`}</title>
              </circle>
            ))}
            {ultimo && <circle cx={ultimo[0]} cy={ultimo[1]} r="4" fill={s.cor} />}
          </g>
        )
      })}
    </svg>
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
  const [dadosMesGrafico, setDadosMesGrafico] = useState(null) // mes inteiro do grafico (so carregado quando o periodo nao e o mes)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [setorGrafico, setSetorGrafico] = useState('') // '' = todos os setores

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
  // O grafico de linhas e SEMPRE do mes (da data de referencia), qualquer que seja o Dia/Semana/Mes
  // escolhido nos cards e na tabela — a meta e mensal.
  const periodoMes = useMemo(() => intervaloDoPeriodo('mes', referencia), [referencia])
  const diasSparkChaves = useMemo(() => ultimosDias(periodo.fim, DIAS_SPARKLINE), [periodo.fim])

  async function carregarTudo() {
    setCarregando(true)
    // Mostra na hora o que ja foi visto deste periodo; a resposta nova troca em seguida.
    const antigo = api.cacheLocal(
      `/api/relatorio-producao?inicio=${encodeURIComponent(periodo.inicio)}&fim=${encodeURIComponent(periodo.fim)}`,
    )
    if (antigo) setDados((atual) => atual ?? antigo)
    try {
      const periodoAnterior = intervaloDoPeriodo(modo, navegarPeriodo(modo, referencia, -1))
      const diasSpark = ultimosDias(periodo.fim, DIAS_SPARKLINE)
      const [atual, anterior, spark, mes] = await Promise.all([
        api.relatorioProducao(periodo.inicio, periodo.fim),
        api.relatorioProducao(periodoAnterior.inicio, periodoAnterior.fim),
        api.relatorioProducao(diasSpark[0], periodo.fim),
        modo === 'mes' ? null : api.relatorioProducao(periodoMes.inicio, periodoMes.fim),
      ])
      setDados(atual)
      setDadosAnterior(anterior)
      setDadosSpark(spark)
      setDadosMesGrafico(modo === 'mes' ? null : mes)
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
  // periodo equivalente anterior (mesmo modo — ex.: dia contra o dia anterior), um
  // "sparkline" com os ultimos 7 dias (sempre na mesma janela, independente do modo
  // escolhido) e a meta do periodo (so pros centros com meta definida, ver producaoCampos.js).
  const cartoes = useMemo(() => {
    if (!dados) return []
    const anteriorPorCentro = new Map((dadosAnterior?.porCentro ?? []).map((c) => [c.centro, c]))
    return dados.porCentro.map((c, i) => {
      const principal = quantidadePrincipal(c.quantidades)
      const anteriorCentro = anteriorPorCentro.get(c.centro)
      const anteriorPrincipal = anteriorCentro ? quantidadePrincipal(anteriorCentro.quantidades) : null
      const tendencia = calcularTendencia(principal?.total ?? 0, anteriorPrincipal?.total ?? 0)
      const serie = dadosSpark ? serieDiariaPorCentro(dadosSpark.detalhado, c.centro, diasSparkChaves) : diasSparkChaves.map(() => 0)
      const metaBase = metaDoPeriodo(c.centro, modo)
      const meta = metaBase && {
        ...metaBase,
        percentual: progressoMeta(metaBase.tipo === 'moeda' ? c.valorProduzido : principal?.total, metaBase.valor),
      }
      return { ...c, cor: corDoCentro(i), principal, tendencia, serie, meta }
    })
  }, [dados, dadosAnterior, dadosSpark, diasSparkChaves, modo])

  const valorTotalPeriodo = useMemo(() => somarValorProduzido(dados?.porCentro), [dados])

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

  // Grafico de linhas acumuladas. Com um setor filtrado: a linha dele + a reta da meta do
  // periodo (quando o setor tem meta — Logistica e em R$, os demais em m²). Com "todos":
  // uma linha por setor na unidade dominante, sem meta (escalas diferentes).
  const dadosDoMes = modo === 'mes' ? dados : dadosMesGrafico

  // Setores do mes inteiro (no modo Dia, o dia pode nao ter todos), com a mesma cor dos cards.
  const setoresDoMes = useMemo(() => {
    if (!dadosDoMes) return []
    return dadosDoMes.porCentro.map((c, i) => ({
      ...c,
      cor: cartoes.find((x) => x.centro === c.centro)?.cor ?? corDoCentro(i),
      principal: quantidadePrincipal(c.quantidades),
      meta: metaDoPeriodo(c.centro, 'mes'),
    }))
  }, [dadosDoMes, cartoes])

  const graficoLinhas = useMemo(() => {
    if (!dadosDoMes || setoresDoMes.length === 0) return null
    const escolhido = setoresDoMes.find((c) => c.centro === setorGrafico) ?? null
    let unidade
    let alvos
    if (escolhido) {
      alvos = [escolhido]
      unidade = escolhido.principal?.unidade
    } else {
      // "Todos": so soma/compara a MESMA unidade — a mais comum entre os setores do mes.
      const comPrincipal = setoresDoMes.filter((c) => c.principal)
      if (comPrincipal.length === 0) return null
      const contagem = new Map()
      for (const c of comPrincipal) contagem.set(c.principal.unidade, (contagem.get(c.principal.unidade) ?? 0) + 1)
      unidade = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0]
      alvos = comPrincipal.filter((c) => c.principal.unidade === unidade)
    }
    const moeda = escolhido?.meta?.tipo === 'moeda'
    const series = alvos.map((c) => {
      const { rotulos, pontos } = serieAcumuladaPorPeriodo(dadosDoMes.detalhado, {
        centro: c.centro,
        inicio: periodoMes.inicio,
        fim: periodoMes.fim,
        modo: 'mes',
        tipo: moeda ? 'moeda' : 'quantidade',
        unidade: moeda ? undefined : unidade,
      })
      return { chave: c.centro, nome: c.centro, cor: c.cor, rotulos, pontos }
    })
    const metaCentro = escolhido?.meta ?? null
    const formatarY = moeda ? (v) => `R$ ${abreviarNumero(v)}` : (v) => abreviarNumero(v)
    const atingido = series[0]?.pontos.filter((p) => p != null).at(-1) ?? 0
    return {
      rotulos: series[0].rotulos,
      series,
      moeda,
      unidade,
      formatarY,
      meta: metaCentro && {
        valor: metaCentro.valor,
        rotulo: `Meta ${moeda ? formatarMoedaNumero(metaCentro.valor) : `${formatarNumeroBr(metaCentro.valor)} ${formatarUnidade(unidade)}`}`,
        atingido,
        percentual: progressoMeta(atingido, metaCentro.valor),
        falta: Math.max(0, metaCentro.valor - atingido),
      },
    }
  }, [dadosDoMes, setoresDoMes, setorGrafico, periodoMes.inicio, periodoMes.fim])

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
        (d.pedido ?? '').toLowerCase().includes(alvo) ||
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
              {valorTotalPeriodo != null && (
                <div
                  className="relatorio-producao__valor-total"
                  title="Soma do valor estimado (rateado do pedido pela quantidade produzida) de todos os centros no período — não é um valor exato do Nomus."
                >
                  <span className="relatorio-producao__valor-total-rotulo">Valor total do período</span>
                  <span className="relatorio-producao__valor-total-numero">{formatarMoedaNumero(valorTotalPeriodo)}</span>
                  <span className="relatorio-producao__valor-total-tag">estimado</span>
                </div>
              )}
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
                    {c.meta ? (
                      <div
                        className="indicador-producao__meta"
                        title="Meta mensal dividida por 22 dias úteis e escalada pro período — não vem do Nomus, é combinada com a operação."
                      >
                        <div className="indicador-producao__meta-linha">
                          <span>
                            Meta: {c.meta.tipo === 'moeda' ? formatarMoedaNumero(c.meta.valor) : `${formatarNumeroBr(c.meta.valor)} m²`}
                          </span>
                          <span
                            className={`indicador-producao__meta-percentual ${
                              c.meta.percentual >= 100 ? 'indicador-producao__meta-percentual--ok' : ''
                            }`}
                          >
                            {formatarNumeroBr(c.meta.percentual)}%
                          </span>
                        </div>
                        <div className="indicador-producao__meta-barra">
                          <div
                            className="indicador-producao__meta-barra-preenchida"
                            style={{ width: `${Math.min(100, c.meta.percentual)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      c.valorProduzido != null && (
                        <div
                          className="indicador-producao__valor-estimado"
                          title="Valor do pedido rateado pela quantidade produzida em cada etapa da OS — estimativa, o Nomus nao informa valor por centro de trabalho."
                        >
                          {formatarMoedaNumero(c.valorProduzido)}
                          <span className="indicador-producao__valor-estimado-rotulo">estimado</span>
                        </div>
                      )
                    )}
                  </div>
                ))}
              </div>

              {(dadosGrafico.itens.length > 0 || graficoLinhas) && (
                <div className="relatorio-producao__graficos">
                  <div className="painel-grafico">
                    <div className="painel-grafico__cabecalho">
                      <div>
                        <h2 className="painel-grafico__titulo">Produção por centro — mês</h2>
                        <p className="painel-grafico__subtitulo">
                          {setorGrafico ? 'Acumulado de' : 'Produção acumulada, por setor, em'} {periodoMes.rotulo}
                          {setorGrafico ? ' contra a meta mensal' : ''}
                        </p>
                      </div>
                      <select
                        className="seletor"
                        aria-label="Filtrar o gráfico por setor"
                        value={setorGrafico}
                        onChange={(e) => setSetorGrafico(e.target.value)}
                      >
                        <option value="">Todos os setores</option>
                        {setoresDoMes.map((c) => (
                          <option key={c.centro} value={c.centro}>
                            {c.centro}
                          </option>
                        ))}
                      </select>
                    </div>
                    {graficoLinhas && (
                      <>
                        <div className="painel-grafico__legenda">
                          {graficoLinhas.series.map((item) => (
                            <span className="painel-grafico__legenda-item" key={item.chave}>
                              <span className="painel-grafico__marcador" style={{ background: item.cor }} />
                              {item.nome}
                            </span>
                          ))}
                          {graficoLinhas.meta && (
                            <span className="painel-grafico__legenda-item">
                              <span className="painel-grafico__marcador painel-grafico__marcador--meta" />
                              Meta
                            </span>
                          )}
                        </div>
                        {graficoLinhas.meta && (
                          <p
                            className={`grafico-meta-status ${graficoLinhas.meta.percentual >= 100 ? 'grafico-meta-status--ok' : ''}`}
                            role="status"
                          >
                            {graficoLinhas.meta.percentual >= 100
                              ? `Meta atingida — ${formatarNumeroBr(graficoLinhas.meta.percentual)}% da meta`
                              : `Meta ainda não atingida — ${formatarNumeroBr(graficoLinhas.meta.percentual)}% (faltam ${
                                  graficoLinhas.moeda
                                    ? formatarMoedaNumero(graficoLinhas.meta.falta)
                                    : `${formatarNumeroBr(graficoLinhas.meta.falta)} ${formatarUnidade(graficoLinhas.unidade)}`
                                })`}
                          </p>
                        )}
                        {!setorGrafico && (
                          <p className="grafico-dica">Escolha um setor para ver a linha da meta.</p>
                        )}
                        <GraficoLinhas
                          rotulos={graficoLinhas.rotulos}
                          series={graficoLinhas.series}
                          meta={graficoLinhas.meta}
                          formatarY={graficoLinhas.formatarY}
                        />
                      </>
                    )}
                  </div>
                  {dadosGrafico.itens.length > 0 && (
                  <div className="painel-grafico">
                    <h2 className="painel-grafico__titulo">Distribuição do período</h2>
                    <p className="painel-grafico__subtitulo">Participação por centro de trabalho</p>
                    <GraficoDonut itens={dadosGrafico.itens} unidade={dadosGrafico.unidade} />
                  </div>
                  )}
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
                  placeholder="Buscar por OS, pedido, etapa ou colaborador..."
                  aria-label="Buscar por OS, pedido, etapa ou colaborador"
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
                    <th>Pedido</th>
                    <th>Etapa</th>
                    <th className="col-numerica">Produção</th>
                    <th>Colaborador</th>
                    <th className="col-numerica">Duração</th>
                    <th className="col-numerica" title="Valor do pedido rateado pela quantidade produzida — estimativa, o Nomus nao informa valor por etapa.">
                      Valor (estimado)
                    </th>
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
                        <td data-rotulo="Pedido">{d.pedido ?? '—'}</td>
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
                        <td data-rotulo="Valor (estimado)" className="col-numerica">
                          {d.valorProduzido != null ? formatarMoedaNumero(d.valorProduzido) : '—'}
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
