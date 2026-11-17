import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatarNumeroBr } from '../numero.js'
import { chaveDia, csvDosLancamentos, dataBr, formatarRendimento, periodoPronto, previaEps } from '../epsCampos.js'
import ModalConfirmar from './ModalConfirmar.jsx'

const PERIODOS = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'semana', rotulo: 'Últimos 7 dias' },
  { id: 'mes', rotulo: 'Mês' },
  { id: 'outro', rotulo: 'Período' },
]

const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/**
 * Producao de placas de EPS (estoque, sem OS e sem Nomus): quem produziu, que tipo de placa,
 * quantos blocos gastou e quantas placas saiu. O esperado sai do rendimento fixo do bloco
 * (trapezio 40, telha forro 20) e a diferenca e a perda. Regras no servidor (server/eps.js).
 */
export default function TelaEps({ adminLiberado = false, onPedirSenha }) {
  const [tipos, setTipos] = useState([])
  const [matricula, setMatricula] = useState('') // fica entre lancamentos (mesmo operador seguido)
  const [tipoId, setTipoId] = useState(null)
  const [blocos, setBlocos] = useState('')
  const [placas, setPlacas] = useState('')
  const [observacao, setObservacao] = useState('')
  const [data, setData] = useState(chaveDia(new Date())) // so admin mexe (retroativo)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null) // { tipo: 'ok'|'erro', texto }
  const [excesso, setExcesso] = useState(null) // mensagem do servidor, esperando confirmacao

  const [periodo, setPeriodo] = useState('hoje')
  const [intervalo, setIntervalo] = useState(() => periodoPronto('hoje'))
  const [dados, setDados] = useState({ lancamentos: [], resumo: null })
  const [erroLista, setErroLista] = useState(null)
  const [cancelando, setCancelando] = useState(null) // lancamento a cancelar

  const tipo = tipos.find((t) => t.id === tipoId) ?? null
  const previa = previaEps(tipo, blocos, placas)

  const carregar = useCallback(() => {
    return api.eps
      .listar(intervalo.inicio, intervalo.fim)
      .then((d) => (setDados(d), setErroLista(null)))
      .catch((e) => setErroLista(e.message))
  }, [intervalo])

  useEffect(() => {
    api.eps.tipos().then(setTipos).catch((e) => setAviso({ tipo: 'erro', texto: e.message }))
  }, [])
  useEffect(() => {
    carregar()
  }, [carregar])

  function escolherPeriodo(id) {
    setPeriodo(id)
    if (id !== 'outro') setIntervalo(periodoPronto(id))
  }

  async function registrar(confirmarExcesso = false) {
    setAviso(null)
    setOcupado(true)
    try {
      const r = await api.eps.lancar({
        matricula: matricula.trim(),
        tipo: tipoId,
        blocos,
        placas,
        observacao,
        data: adminLiberado ? data : undefined,
        confirmarExcesso,
      })
      setExcesso(null)
      setAviso({
        tipo: 'ok',
        texto: `Registrado: ${r.colaborador.nome} — ${r.placas} placas de ${r.tipoRotulo} (${r.blocos} bloco${r.blocos > 1 ? 's' : ''}).`,
      })
      setBlocos('')
      setPlacas('')
      setObservacao('')
      carregar()
    } catch (erro) {
      if (erro.codigo === 'EXCESSO_SOBRE_ESPERADO') setExcesso(erro.message)
      else setAviso({ tipo: 'erro', texto: erro.message })
    } finally {
      setOcupado(false)
    }
  }

  function aoSubmeter(e) {
    e.preventDefault()
    if (!matricula.trim()) return setAviso({ tipo: 'erro', texto: 'Bipe o crachá ou digite a matrícula do colaborador.' })
    if (!tipoId) return setAviso({ tipo: 'erro', texto: 'Escolha o tipo de placa.' })
    if (!blocos || !placas) return setAviso({ tipo: 'erro', texto: 'Informe os blocos usados e as placas produzidas.' })
    registrar(false)
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
    } catch (erro) {
      setCancelando(null)
      setErroLista(erro.message)
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
          <h1 className="entregas__titulo">PLACAS DE EPS</h1>
          <p className="entregas__subtitulo">Produção para estoque — blocos usados e placas produzidas.</p>
        </div>
      </div>

      <form className="entregas__painel eps__form" onSubmit={aoSubmeter}>
        <h2 className="entregas__painel-titulo">Novo lançamento</h2>

        <div className="entregas__campo">
          <label htmlFor="eps-matricula">Matrícula do colaborador</label>
          <input
            id="eps-matricula"
            className="modal__campo"
            value={matricula}
            onChange={(e) => setMatricula(e.target.value)}
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            placeholder="Bipe o crachá"
            disabled={ocupado}
          />
        </div>

        <div className="entregas__campo">
          <label>Tipo de placa</label>
          <div className="eps__tipos" role="radiogroup" aria-label="Tipo de placa">
            {tipos.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === tipoId}
                className={`eps__tipo ${t.id === tipoId ? 'eps__tipo--ativo' : ''}`}
                onClick={() => setTipoId(t.id)}
                disabled={ocupado}
              >
                <strong>{t.familia}</strong>
                <span>{t.perfil}</span>
                <small>{t.placasPorBloco} placas por bloco</small>
              </button>
            ))}
          </div>
        </div>

        <div className="eps__numeros">
          <div className="entregas__campo">
            <label htmlFor="eps-blocos">Blocos usados</label>
            <input
              id="eps-blocos"
              className="modal__campo eps__numero"
              value={blocos}
              onChange={(e) => setBlocos(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              autoComplete="off"
              disabled={ocupado}
            />
          </div>
          <div className="entregas__campo">
            <label htmlFor="eps-placas">Placas produzidas</label>
            <input
              id="eps-placas"
              className="modal__campo eps__numero"
              value={placas}
              onChange={(e) => setPlacas(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              autoComplete="off"
              disabled={ocupado}
            />
          </div>
        </div>

        {previa && (
          <p className="eps__previa" aria-live="polite">
            Esperado: <strong>{formatarNumeroBr(previa.esperado)}</strong> placas
            {previa.diferenca != null && (
              <>
                {' · '}diferença{' '}
                <strong className={classeDiferenca(previa.diferenca)}>{sinal(previa.diferenca)}</strong>
                {' · '}rendimento <strong>{formatarRendimento(previa.rendimento)}</strong>
              </>
            )}
          </p>
        )}

        <div className="eps__numeros">
          <div className="entregas__campo">
            <label htmlFor="eps-obs">Observação (opcional)</label>
            <input id="eps-obs" className="modal__campo" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={200} disabled={ocupado} />
          </div>
          {adminLiberado && (
            <div className="entregas__campo">
              <label htmlFor="eps-data">Data (retroativo)</label>
              <input id="eps-data" type="date" className="modal__campo" value={data} onChange={(e) => setData(e.target.value)} disabled={ocupado} />
            </div>
          )}
        </div>

        {aviso && <p className={`aviso aviso--${aviso.tipo}`}>{aviso.texto}</p>}

        <button type="submit" className="botao botao--iniciar" disabled={ocupado}>
          {ocupado ? 'Registrando...' : 'REGISTRAR PRODUÇÃO'}
        </button>
      </form>

      <div className="lista-cabecalho eps__cabecalho">
        <h2 className="lista-titulo">Produção registrada</h2>
        <div className="eps__periodos">
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
      </div>

      {erroLista && <p className="aviso aviso--erro">{erroLista}</p>}

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

      {excesso && (
        <ModalConfirmar
          titulo="Placas acima do esperado"
          mensagem={`${excesso} Registrar mesmo assim?`}
          textoConfirmar="Registrar mesmo assim"
          textoCancelar="Corrigir"
          confirmando={ocupado}
          onConfirmar={() => registrar(true)}
          onCancelar={() => setExcesso(null)}
        />
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
