import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { formatarMoedaNumero, formatarNumeroBr } from '../numero.js'
import { chaveDia, formatarRendimento, previaEps } from '../epsCampos.js'
import ModalConfirmar from './ModalConfirmar.jsx'
import TelaEpsRelatorio from './TelaEpsRelatorio.jsx'

const IconeMatricula = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="9" cy="11" r="2.25" />
    <path d="M5.5 16.5c.6-2 2-3 3.5-3s2.9 1 3.5 3" strokeLinecap="round" />
    <path d="M14.5 9.5h4M14.5 13h4" strokeLinecap="round" />
  </svg>
)

const IconePlaca = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M3 9l9-5 9 5-9 5-9-5z" strokeLinejoin="round" />
    <path d="M3 13.5l9 5 9-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconeBloco = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" strokeLinejoin="round" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" strokeLinejoin="round" />
  </svg>
)

const IconeNumero = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M9 4L7 20M17 4l-2 16M4.5 9h16M3.5 15h16" strokeLinecap="round" />
  </svg>
)

/**
 * Apontamento da producao de placas de EPS (estoque, sem OS e sem Nomus), com o mesmo jeito da
 * tela de Apontamento: uma linha por informacao e botoes grandes. O esperado sai do rendimento
 * fixo do bloco (ver TIPOS_EPS); a diferenca e a perda. Regras em server/eps.js.
 * O relatorio fica numa tela separada (TelaEpsRelatorio.jsx), aberta pelo botao daqui.
 */
export default function TelaEps({ adminLiberado = false, onPedirSenha }) {
  const [visao, setVisao] = useState('apontar') // 'apontar' | 'relatorio'
  const [tipos, setTipos] = useState([])
  // Fica entre lancamentos (mesmo operador lancando varias vezes), como no Apontamento.
  const [matricula, setMatricula] = useState('')
  const [tipoId, setTipoId] = useState(null)
  const [blocos, setBlocos] = useState('')
  const [placas, setPlacas] = useState('')
  const [observacao, setObservacao] = useState('')
  const [data, setData] = useState(chaveDia(new Date())) // so admin mexe (retroativo)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null) // { tipo: 'ok'|'erro', texto }
  const [excesso, setExcesso] = useState(null) // mensagem do servidor, esperando confirmacao

  const refMatricula = useRef(null)
  const refBlocos = useRef(null)
  const refPlacas = useRef(null)

  const tipo = tipos.find((t) => t.id === tipoId) ?? null
  const previa = previaEps(tipo, blocos, placas)

  useEffect(() => {
    api.eps.tipos().then(setTipos).catch((e) => setAviso({ tipo: 'erro', texto: e.message }))
  }, [])

  useEffect(() => {
    if (visao === 'apontar') refMatricula.current?.focus()
  }, [visao])

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
      setTipoId(null)
    } catch (erro) {
      if (erro.codigo === 'EXCESSO_SOBRE_ESPERADO') setExcesso(erro.message)
      else setAviso({ tipo: 'erro', texto: erro.message })
    } finally {
      setOcupado(false)
    }
  }

  function aoRegistrar() {
    if (!matricula.trim()) return setAviso({ tipo: 'erro', texto: 'Bipe o crachá ou digite a matrícula do colaborador.' })
    if (!tipoId) return setAviso({ tipo: 'erro', texto: 'Escolha o tipo de placa.' })
    if (!blocos || !placas) return setAviso({ tipo: 'erro', texto: 'Informe os blocos utilizados e as placas produzidas.' })
    registrar(false)
  }

  // Enter pula pro proximo campo (leitor de cracha termina com Enter); no ultimo, registra.
  const aoTeclar = (proximo) => (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (proximo) proximo.current?.focus()
    else aoRegistrar()
  }

  if (visao === 'relatorio') {
    return (
      <TelaEpsRelatorio
        matricula={matricula}
        adminLiberado={adminLiberado}
        onPedirSenha={onPedirSenha}
        onVoltar={() => setVisao('apontar')}
      />
    )
  }

  const classeDiferenca = (d) => (d < 0 ? 'eps__neg' : d > 0 ? 'eps__pos' : '')

  return (
    <>
      <main className="leitura">
        <h1 className="leitura__titulo">APONTAMENTO DE PLACAS DE EPS</h1>
        <p className="leitura__subtitulo">Bloco de 1000 × 1200 × 2000 mm. Informe os dados abaixo para registrar a produção.</p>

        <div className="leitura__linha">
          <div className="leitura__rotulo">
            <span className="leitura__icone">
              <IconeMatricula />
            </span>
            <span>
              <strong>MATRÍCULA DO COLABORADOR</strong>
              <small>Bipe o crachá antes de lançar</small>
            </span>
          </div>
          <div className="leitura__campo">
            <input
              ref={refMatricula}
              value={matricula}
              onChange={(e) => setMatricula(e.target.value)}
              onKeyDown={aoTeclar(refBlocos)}
              onFocus={(e) => e.target.select()}
              disabled={ocupado}
              autoComplete="off"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Matrícula do colaborador"
              autoFocus
            />
            <span className="leitura__marca" aria-hidden="true">
              <IconeMatricula />
            </span>
          </div>
        </div>

        <div className="leitura__linha">
          <div className="leitura__rotulo">
            <span className="leitura__icone">
              <IconePlaca />
            </span>
            <span>
              <strong>1 - TIPO DE PLACA</strong>
              <small>Toque no tipo que está sendo produzido</small>
            </span>
          </div>
          <div className="leitura__campo leitura__campo--tipos">
            <div className="eps__tipos" role="radiogroup" aria-label="Tipo de placa">
              {tipos.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={t.id === tipoId}
                  className={`eps__tipo ${t.id === tipoId ? 'eps__tipo--ativo' : ''}`}
                  onClick={() => (setTipoId(t.id), refBlocos.current?.focus())}
                  disabled={ocupado}
                >
                  <strong>{t.familia}</strong>
                  <span>{t.perfil}</span>
                  <small>
                    {t.placasPorBloco} placas de {t.comprimentoM} m por bloco
                  </small>
                  <small>{formatarMoedaNumero(t.valorPlaca)} a placa</small>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="leitura__linha">
          <div className="leitura__rotulo">
            <span className="leitura__icone">
              <IconeBloco />
            </span>
            <span>
              <strong>2 - BLOCOS UTILIZADOS</strong>
              <small>Quantidade de blocos de EPS usados</small>
            </span>
          </div>
          <div className="leitura__campo">
            <input
              ref={refBlocos}
              value={blocos}
              onChange={(e) => setBlocos(e.target.value.replace(/\D/g, ''))}
              onKeyDown={aoTeclar(refPlacas)}
              disabled={ocupado}
              autoComplete="off"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Quantidade de blocos utilizados"
            />
            <span className="leitura__marca" aria-hidden="true">
              <IconeBloco />
            </span>
          </div>
        </div>

        <div className="leitura__linha">
          <div className="leitura__rotulo">
            <span className="leitura__icone">
              <IconeNumero />
            </span>
            <span>
              <strong>3 - PLACAS PRODUZIDAS</strong>
              <small>Quantidade de placas que saíram</small>
            </span>
          </div>
          <div className="leitura__campo">
            <input
              ref={refPlacas}
              value={placas}
              onChange={(e) => setPlacas(e.target.value.replace(/\D/g, ''))}
              onKeyDown={aoTeclar(null)}
              disabled={ocupado}
              autoComplete="off"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Quantidade de placas produzidas"
            />
            <span className="leitura__marca" aria-hidden="true">
              <IconeNumero />
            </span>
          </div>
        </div>

        {previa && (
          <p className="eps__previa" aria-live="polite">
            Esperado: <strong>{formatarNumeroBr(previa.esperado)}</strong> placas
            {previa.diferenca != null && (
              <>
                {' · '}diferença{' '}
                <strong className={classeDiferenca(previa.diferenca)}>{previa.diferenca > 0 ? `+${previa.diferenca}` : previa.diferenca}</strong>
                {' · '}rendimento <strong>{formatarRendimento(previa.rendimento)}</strong>
                {' · '}valor <strong>{formatarMoedaNumero(Number(placas) * tipo.valorPlaca)}</strong>
              </>
            )}
          </p>
        )}

        <div className="eps__extras">
          <input
            className="modal__campo"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={200}
            placeholder="Observação (opcional) — ex.: refile, quebra"
            aria-label="Observação"
            disabled={ocupado}
          />
          {adminLiberado && (
            <input type="date" className="modal__campo" value={data} onChange={(e) => setData(e.target.value)} aria-label="Data do lançamento (retroativo)" disabled={ocupado} />
          )}
        </div>

        <div className="leitura__acoes">
          <button type="button" className="botao botao--iniciar" onClick={aoRegistrar} disabled={ocupado}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {ocupado ? 'AGUARDE...' : 'REGISTRAR PRODUÇÃO'}
          </button>

          <button type="button" className="botao botao--neutro eps__ver-relatorio" onClick={() => setVisao('relatorio')} disabled={ocupado}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 20V10M12 20V4M19 20v-7" strokeLinecap="round" />
            </svg>
            VER RELATÓRIO
          </button>
        </div>

        {aviso && (
          <p className={`aviso aviso--${aviso.tipo}`} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>
            {aviso.texto}
          </p>
        )}
      </main>

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
    </>
  )
}
