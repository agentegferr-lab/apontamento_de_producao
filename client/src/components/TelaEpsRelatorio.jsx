import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatarNumeroBr } from '../numero.js'
import { csvDosLancamentos, dataBr, formatarRendimento, periodoPronto } from '../epsCampos.js'
import ModalConfirmar from './ModalConfirmar.jsx'

const PERIODOS = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'semana', rotulo: 'Últimos 7 dias' },
  { id: 'mes', rotulo: 'Mês' },
  { id: 'outro', rotulo: 'Período' },
]

const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/**
 * Relatorio da producao de EPS: totais, rendimento por tipo e por colaborador, lista dos
 * lancamentos (com cancelamento por admin) e exportacao em CSV. Aberto pelo botao
 * "VER RELATORIO" da tela de apontamento de EPS (TelaEps.jsx).
 */
export default function TelaEpsRelatorio({ matricula = '', adminLiberado = false, onPedirSenha, onVoltar }) {
  const [periodo, setPeriodo] = useState('hoje')
  const [intervalo, setIntervalo] = useState(() => periodoPronto('hoje'))
  const [dados, setDados] = useState({ lancamentos: [], resumo: null })
  const [erro, setErro] = useState(null)
  const [cancelando, setCancelando] = useState(null) // lancamento a cancelar

  const carregar = useCallback(() => {
    return api.eps
      .listar(intervalo.inicio, intervalo.fim)
      .then((d) => (setDados(d), setErro(null)))
      .catch((e) => setErro(e.message))
  }, [intervalo])

  useEffect(() => {
    carregar()
  }, [carregar])

  function escolherPeriodo(id) {
    setPeriodo(id)
    if (id !== 'outro') setIntervalo(periodoPronto(id))
  }

  function pedirCancelamento(lancamento) {
    if (!adminLiberado) return onPedirSenha?.()
    setCancelando(lancamento)
  }

  async function cancelarLancamento() {
    try {
      await api.eps.cancelar(cancelando.id, matricula.trim())
      setCancelando(null)
      carregar()
    } catch (e) {
      setCancelando(null)
      setErro(e.message)
    }
  }

  function baixarCsv() {
    const blob = new Blob([csvDosLancamentos(dados.lancamentos)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eps-${intervalo.inicio}-a-${intervalo.fim}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const resumo = dados.resumo
  const classeDiferenca = (d) => (d < 0 ? 'eps__neg' : d > 0 ? 'eps__pos' : '')
  const sinal = (d) => (d > 0 ? `+${d}` : String(d))

  return (
    <main className="entregas eps">
      <div className="entregas__topo">
        <div>
          <h1 className="entregas__titulo">RELATÓRIO DE PLACAS DE EPS</h1>
          <p className="entregas__subtitulo">Blocos usados, placas produzidas e rendimento por tipo e colaborador.</p>
        </div>
        <div className="entregas__acoes-topo">
          <button type="button" className="botao botao--neutro eps__botao-topo" onClick={onVoltar}>
            ← Voltar ao apontamento
          </button>
        </div>
      </div>

      <div className="eps__periodos eps__periodos--topo">
        {PERIODOS.map((p) => (
          <button key={p.id} type="button" className={`botao botao--neutro ${periodo === p.id ? 'eps__periodo--ativo' : ''}`} onClick={() => escolherPeriodo(p.id)}>
            {p.rotulo}
          </button>
        ))}
        {periodo === 'outro' && (
          <>
            <input type="date" className="modal__campo" value={intervalo.inicio} onChange={(e) => setIntervalo((i) => ({ ...i, inicio: e.target.value }))} aria-label="Data inicial" />
            <input type="date" className="modal__campo" value={intervalo.fim} onChange={(e) => setIntervalo((i) => ({ ...i, fim: e.target.value }))} aria-label="Data final" />
          </>
        )}
        <button type="button" className="botao botao--neutro" onClick={baixarCsv} disabled={dados.lancamentos.length === 0}>
          Baixar Excel (CSV)
        </button>
      </div>

      {erro && <p className="aviso aviso--erro">{erro}</p>}

      {resumo && (
        <div className="entregas__indicadores">
          <div className="indicador">
            <span className="indicador__titulo">Blocos usados</span>
            <span className="indicador__valor">{formatarNumeroBr(resumo.total.blocos)}</span>
          </div>
          <div className="indicador">
            <span className="indicador__titulo">Placas produzidas</span>
            <span className="indicador__valor">{formatarNumeroBr(resumo.total.placas)}</span>
            <span className="indicador__aux">esperado {formatarNumeroBr(resumo.total.esperado)}</span>
          </div>
          <div className="indicador">
            <span className="indicador__titulo">Perda</span>
            <span className="indicador__valor">{formatarNumeroBr(resumo.total.perda)}</span>
            <span className="indicador__aux">placas abaixo do esperado</span>
          </div>
          <div className="indicador">
            <span className="indicador__titulo">Rendimento</span>
            <span className="indicador__valor">{formatarRendimento(resumo.total.rendimento)}</span>
            <span className="indicador__aux">{resumo.total.lancamentos} lançamento(s)</span>
          </div>
        </div>
      )}

      {resumo && resumo.total.lancamentos > 0 && (
        <div className="eps__resumos">
          <div className="tabela-wrap">
            <table className="relatorio-producao__tabela">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th className="col-numerica">Blocos</th>
                  <th className="col-numerica">Placas</th>
                  <th className="col-numerica">Rendimento</th>
                </tr>
              </thead>
              <tbody>
                {resumo.porTipo.map((t) => (
                  <tr key={t.tipo}>
                    <td>{t.rotulo}</td>
                    <td className="col-numerica">{formatarNumeroBr(t.blocos)}</td>
                    <td className="col-numerica">{formatarNumeroBr(t.placas)}</td>
                    <td className="col-numerica">{formatarRendimento(t.rendimento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tabela-wrap">
            <table className="relatorio-producao__tabela">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th className="col-numerica">Blocos</th>
                  <th className="col-numerica">Placas</th>
                  <th className="col-numerica">Rendimento</th>
                </tr>
              </thead>
              <tbody>
                {resumo.porColaborador.map((c) => (
                  <tr key={c.matricula ?? c.nome}>
                    <td>{c.nome}</td>
                    <td className="col-numerica">{formatarNumeroBr(c.blocos)}</td>
                    <td className="col-numerica">{formatarNumeroBr(c.placas)}</td>
                    <td className="col-numerica">{formatarRendimento(c.rendimento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2 className="lista-titulo eps__lista-titulo">Lançamentos</h2>
      {dados.lancamentos.length === 0 ? (
        <p className="vazio">Nenhuma produção registrada neste período.</p>
      ) : (
        <div className="tabela-wrap">
          <table className="relatorio-producao__tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Colaborador</th>
                <th>Tipo</th>
                <th className="col-numerica">Blocos</th>
                <th className="col-numerica">Placas</th>
                <th className="col-numerica">Esperado</th>
                <th className="col-numerica">Dif.</th>
                <th>Observação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.lancamentos.map((l) => (
                <tr key={l.id}>
                  <td>
                    {dataBr(l.data)} <small>{hora(l.em)}</small>
                  </td>
                  <td>{l.colaborador?.nome}</td>
                  <td>{l.tipoRotulo}</td>
                  <td className="col-numerica">{l.blocos}</td>
                  <td className="col-numerica">{l.placas}</td>
                  <td className="col-numerica">{l.esperado}</td>
                  <td className={`col-numerica ${classeDiferenca(l.diferenca)}`}>{sinal(l.diferenca)}</td>
                  <td>{l.observacao}</td>
                  <td>
                    <button type="button" className="botao botao--neutro eps__cancelar" onClick={() => pedirCancelamento(l)}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cancelando && (
        <ModalConfirmar
          titulo="Cancelar lançamento"
          mensagem={`Cancelar o lançamento de ${cancelando.colaborador?.nome} (${cancelando.placas} placas de ${cancelando.tipoRotulo}, ${dataBr(cancelando.data)})? Ele deixa de contar nos totais.`}
          textoConfirmar="Cancelar lançamento"
          textoCancelar="Voltar"
          onConfirmar={cancelarLancamento}
          onCancelar={() => setCancelando(null)}
        />
      )}
    </main>
  )
}
