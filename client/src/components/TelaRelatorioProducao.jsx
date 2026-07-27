import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { formatarNumeroBr } from '../numero.js'
import { intervaloDoPeriodo, navegarPeriodo, formatarDuracao, gerarCsvRelatorioProducao } from '../producaoCampos.js'

const MODOS_PERIODO = [
  { valor: 'dia', texto: 'Dia' },
  { valor: 'semana', texto: 'Semana' },
  { valor: 'mes', texto: 'Mês' },
]

function chaveDoDia(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "METRO QUADRADO" -> "Metro quadrado" — a unidade vem do Nomus em maiusculas, formatada so
 * pra nao gritar na tela; nao ha lista fixa de unidades conhecidas, entao e so um title-case. */
function formatarUnidade(unidade) {
  if (!unidade) return ''
  return unidade.charAt(0) + unidade.slice(1).toLowerCase()
}

function pluralizar(n, singular, plural) {
  return n === 1 ? singular : plural
}

/**
 * Relatorio de producao por centro de trabalho (Corte, Pintura...) num periodo — ver
 * server/relatorioProducao.js. Sem senha (so leitura, mesmo padrao do Relatorio de Entregas).
 */
export default function TelaRelatorioProducao() {
  const [modo, setModo] = useState('dia')
  const [referencia, setReferencia] = useState(() => new Date())
  const [dados, setDados] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [filtroCentro, setFiltroCentro] = useState('')

  const dataOcultaRef = useRef(null)

  const periodo = useMemo(() => intervaloDoPeriodo(modo, referencia), [modo, referencia])

  async function carregar(inicio, fim) {
    setCarregando(true)
    try {
      const r = await api.relatorioProducao(inicio, fim)
      setDados(r)
      setErro(null)
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar(periodo.inicio, periodo.fim)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo.inicio, periodo.fim])

  // Filtro por centro nao sobrevive a troca de periodo — um centro que so aparece no periodo
  // anterior deixaria o filtro selecionado escondendo tudo, sem nenhuma pista do porque.
  useEffect(() => {
    setFiltroCentro('')
  }, [periodo.inicio, periodo.fim])

  function abrirSeletorDeData() {
    const el = dataOcultaRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.focus()
  }

  const detalhesFiltrados = useMemo(() => {
    if (!dados) return []
    const alvo = busca.trim().toLowerCase()
    return dados.detalhado.filter((d) => {
      if (filtroCentro && d.centro !== filtroCentro) return false
      if (!alvo) return true
      return (
        (d.nomeOrdem ?? '').toLowerCase().includes(alvo) ||
        (d.funcionario ?? '').toLowerCase().includes(alvo) ||
        (d.descricaoEtapa ?? '').toLowerCase().includes(alvo)
      )
    })
  }, [dados, busca, filtroCentro])

  // PDF de verdade pra baixar (nao e window.print()) — o servidor monta o arquivo (ver
  // server/relatorioProducaoPdf.js) com os MESMOS dados/filtros ja carregados na tela, e o
  // Content-Disposition da resposta ja dispara o download sozinho, sem precisar de blob aqui.
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

  return (
    <main className="relatorio-producao">
      <div className="relatorio-producao__topo">
        <div>
          <h1 className="relatorio-producao__titulo">Relatório de Produção</h1>
          <p className="relatorio-producao__subtitulo">Veja quanto foi produzido por centro de trabalho em cada período.</p>
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
            onClick={() => carregar(periodo.inicio, periodo.fim)}
            disabled={carregando}
          >
            {carregando ? 'Atualizando...' : 'Atualizar'}
          </button>
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
          {dados.porCentro.length === 0 ? (
            <p className="vazio">Nenhum apontamento registrado neste período.</p>
          ) : (
            <div className="relatorio-producao__indicadores">
              {dados.porCentro.map((c) => (
                <div className="indicador" key={c.centro}>
                  <span className="indicador__titulo">{c.centro}</span>
                  {c.quantidades.length === 0 ? (
                    <span className="indicador__valor">—</span>
                  ) : (
                    c.quantidades.map((q) => (
                      <span className="indicador__valor" key={q.unidade}>
                        {formatarNumeroBr(q.total)} {formatarUnidade(q.unidade)}
                      </span>
                    ))
                  )}
                  <span className="indicador__aux">
                    {c.ordens} {pluralizar(c.ordens, 'ordem', 'ordens')} · {formatarDuracao(c.tempoMs)}
                  </span>
                </div>
              ))}
            </div>
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
                  placeholder="Buscar OS, etapa ou colaborador"
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
              <button
                type="button"
                className="botao botao--neutro botao--pequeno"
                onClick={exportarCsv}
                disabled={detalhesFiltrados.length === 0}
              >
                Exportar CSV
              </button>
              <button type="button" className="botao botao--neutro botao--pequeno" onClick={baixarPdf}>
                Baixar PDF
              </button>
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
                  {detalhesFiltrados.map((d) => (
                    <tr key={d.id}>
                      <td data-rotulo="Data/hora">{d.dataHoraFinal ?? '—'}</td>
                      <td data-rotulo="Centro">{d.centro}</td>
                      <td data-rotulo="OS">{d.nomeOrdem ?? '—'}</td>
                      <td data-rotulo="Etapa">{d.descricaoEtapa ?? '—'}</td>
                      <td data-rotulo="Produção" className="col-numerica">
                        {d.quantidade != null ? `${formatarNumeroBr(d.quantidade)} ${formatarUnidade(d.unidadeMedida)}` : '—'}
                      </td>
                      <td data-rotulo="Colaborador">{d.funcionario ?? '—'}</td>
                      <td data-rotulo="Duração" className="col-numerica">
                        {formatarDuracao(d.duracaoMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
