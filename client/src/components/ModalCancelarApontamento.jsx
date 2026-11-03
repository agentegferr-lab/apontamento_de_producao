import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatarNumeroBr } from '../numero.js'

const MOTIVOS = ['Quantidade errada', 'Operação errada', 'Outro motivo']

/** "22/10/2026 15:23:28" -> "22/10 15:23" (o Nomus manda DD/MM/AAAA HH:mm:ss). */
function dataHoraCurta(valor) {
  const m = /^(\d{2})\/(\d{2})\/\d{4}\s+(\d{2}:\d{2})/.exec(String(valor ?? ''))
  if (m) return `${m[1]}/${m[2]} ${m[3]}`
  const iso = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(String(valor ?? ''))
  return iso ? `${iso[2]}/${iso[1]} ${iso[3]}` : '—'
}

/**
 * Cancela um apontamento feito errado (quantidade ou operacao) da ordem + etapa lidas na tela:
 *  - processo AINDA em andamento no terminal: descarta (nunca foi pro Nomus);
 *  - apontamentos JA gravados no Nomus: manda pra lixeira do Nomus (pede a senha de administrador).
 * Depois e so apontar de novo. Tudo fica registrado no servidor (dados/cancelamentos.json).
 */
export default function ModalCancelarApontamento({ codigoOrdem, codigoProcesso, matricula, adminLiberado, onPedirSenha, onFechar, onMudou }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)
  const [selecionados, setSelecionados] = useState(new Set())
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const [detalhe, setDetalhe] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null) // { texto }

  async function carregar() {
    setErro(null)
    try {
      const d = await api.cancelamento.consultar(codigoOrdem, codigoProcesso)
      setDados(d)
      setSelecionados(new Set(d.gravados.map((g) => g.id)))
    } catch (e) {
      setErro(e.message)
    }
  }

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const textoMotivo = [motivo, detalhe.trim()].filter(Boolean).join(' — ')

  function alternar(id) {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  async function descartarAndamento() {
    setEnviando(true)
    setErro(null)
    try {
      await api.cancelamento.descartarEmAndamento({ codigoOrdem, codigoProcesso, matricula, motivo: textoMotivo })
      setResultado({ texto: 'Processo em andamento descartado. Nada foi enviado ao Nomus — pode iniciar de novo.' })
      onMudou?.()
    } catch (e) {
      setErro(e.message)
    } finally {
      setEnviando(false)
    }
  }

  async function cancelarGravados() {
    if (!adminLiberado) {
      onPedirSenha?.()
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      const r = await api.cancelamento.cancelarGravados({ codigoOrdem, codigoProcesso, ids: [...selecionados], matricula, motivo: textoMotivo })
      const falhas = r.falhas?.length ? ` (${r.falhas.length} não foi possível cancelar)` : ''
      setResultado({
        texto: `${r.cancelados.length} apontamento(s) enviado(s) para a lixeira do Nomus${falhas}. Agora é só apontar de novo com os dados certos.`,
      })
      onMudou?.()
    } catch (e) {
      setErro(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const op = dados?.operacao
  const nadaParaCancelar = dados && !dados.emAndamento && dados.gravados.length === 0

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Cancelar apontamento" onClick={onFechar}>
      <div className="modal__caixa modal__caixa--larga" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__titulo">Cancelar apontamento</h2>

        {!dados && !erro && <p className="modal__texto">Procurando os apontamentos desta etapa no Nomus...</p>}
        {erro && (
          <p className="aviso aviso--erro" role="alert">
            {erro}
          </p>
        )}

        {resultado && (
          <>
            <p className="aviso aviso--ok" role="status">
              {resultado.texto}
            </p>
            <div className="modal__acoes">
              <button className="botao botao--iniciar" onClick={onFechar}>
                Fechar
              </button>
            </div>
          </>
        )}

        {dados && !resultado && (
          <>
            <p className="modal__texto">
              <strong>{op.nomeOrdem}</strong> · etapa {op.operacao}
              {op.descricao ? ` — ${op.descricao}` : ''}
            </p>

            <label className="cancelamento__rotulo" htmlFor="cancelamento-motivo">
              Motivo
            </label>
            <div className="cancelamento__motivo">
              <select id="cancelamento-motivo" className="seletor" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {MOTIVOS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input className="modal__campo" placeholder="Detalhe (opcional)" value={detalhe} maxLength={120} onChange={(e) => setDetalhe(e.target.value)} />
            </div>

            {nadaParaCancelar && <p className="aviso aviso--erro">Esta etapa não tem nenhum apontamento gravado nem processo em andamento.</p>}

            {dados.emAndamento && (
              <section className="cancelamento__bloco">
                <h3 className="cancelamento__subtitulo">Em andamento no terminal</h3>
                <p className="modal__texto">
                  Iniciado em {dataHoraCurta(dados.emAndamento.dataHoraInicial)}
                  {dados.emAndamento.nomeFuncionario ? ` por ${dados.emAndamento.nomeFuncionario}` : ''}
                  {dados.emAndamento.estado === 'PAUSADO' ? ' (pausado)' : ''}. Ainda não foi para o Nomus: descartar não deixa rastro lá.
                </p>
                <button className="botao botao--finalizar" onClick={descartarAndamento} disabled={enviando}>
                  {enviando ? 'AGUARDE...' : 'DESCARTAR ESTE PROCESSO'}
                </button>
              </section>
            )}

            {dados.gravados.length > 0 && (
              <section className="cancelamento__bloco">
                <h3 className="cancelamento__subtitulo">Já gravados no Nomus</h3>
                <ul className="cancelamento__lista">
                  {dados.gravados.map((g) => (
                    <li key={g.id}>
                      <label className="cancelamento__item">
                        <input type="checkbox" checked={selecionados.has(g.id)} onChange={() => alternar(g.id)} />
                        <span>
                          <strong>{dataHoraCurta(g.dataHoraInicial)} → {dataHoraCurta(g.dataHoraFinal)}</strong>
                          <small>
                            {g.quantidade > 0 ? `${formatarNumeroBr(g.quantidade)} ${g.unidadeMedida ? g.unidadeMedida.toLowerCase() : ''}` : 'sem quantidade'}
                            {g.nomeFuncionario ? ` · ${g.nomeFuncionario}` : ''} · nº {g.id}
                          </small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="modal__texto">
                  Os selecionados vão para a <strong>lixeira do Nomus</strong> e deixam de contar na produção. Só administrador.
                </p>
                <button className="botao botao--finalizar" onClick={cancelarGravados} disabled={enviando || selecionados.size === 0}>
                  {enviando
                    ? 'AGUARDE...'
                    : adminLiberado
                      ? `CANCELAR ${selecionados.size} APONTAMENTO(S) NO NOMUS`
                      : 'CANCELAR NO NOMUS (PEDE A SENHA)'}
                </button>
              </section>
            )}

            <div className="modal__acoes">
              <button className="botao botao--neutro" onClick={onFechar}>
                Voltar
              </button>
            </div>
          </>
        )}

        {erro && !dados && (
          <div className="modal__acoes">
            <button className="botao botao--neutro" onClick={onFechar}>
              Voltar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
