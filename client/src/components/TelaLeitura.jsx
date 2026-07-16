import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { agoraLocalISO } from '../tempo.js'

const IconeBarcode = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M3 5v14M6.5 5v14M10 5v10M13.5 5v14M17 5v10M20.5 5v14" strokeLinecap="round" />
  </svg>
)

const IconeProcesso = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="8.5" y="2.5" width="7" height="6" rx="1.5" />
    <rect x="2" y="15.5" width="7" height="6" rx="1.5" />
    <rect x="15" y="15.5" width="7" height="6" rx="1.5" />
    <path d="M12 8.5v3.5M5.5 15.5V12h13v3.5" strokeLinecap="round" />
  </svg>
)

/**
 * Um campo por etiqueta, como no leitor fisico: le a ordem, o foco pula pro processo,
 * le o processo e o operador escolhe Iniciar ou Finalizar. Nao ha submit implicito — o
 * Enter e tratado na mao, pra leitura nunca depender do numero de campos do form.
 */
export default function TelaLeitura({ terminal, onMudouAndamento }) {
  const [ordem, setOrdem] = useState('')
  const [processo, setProcesso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null) // { tipo: 'ok'|'erro', texto }
  const [pedindo, setPedindo] = useState(null) // { campo, rotulo, valor } quando a atividade exige
  const [escolhendoAtividade, setEscolhendoAtividade] = useState(null) // { atividades, extras }
  const [escolhendoMotivo, setEscolhendoMotivo] = useState(null) // { motivos } ao pausar

  const refOrdem = useRef(null)
  const refProcesso = useRef(null)
  const refQuantidade = useRef(null)

  useEffect(() => {
    if (pedindo) refQuantidade.current?.focus()
    else refOrdem.current?.focus()
  }, [pedindo])

  function limpar() {
    setOrdem('')
    setProcesso('')
    setPedindo(null)
    setEscolhendoAtividade(null)
    setEscolhendoMotivo(null)
    refOrdem.current?.focus()
  }

  async function acionar(acao, extras = {}) {
    if (!ordem.trim() || !processo.trim()) {
      setAviso({ tipo: 'erro', texto: 'Leia a ordem de servico e a etapa do processo antes de continuar.' })
      ;(!ordem.trim() ? refOrdem : refProcesso).current?.focus()
      return
    }
    setOcupado(true)
    setAviso(null)
    try {
      const corpo = { codigoOrdem: ordem.trim(), codigoProcesso: processo.trim(), ...extras }

      if (acao === 'iniciar') {
        const r = await api.iniciar(corpo)
        setAviso({
          tipo: 'ok',
          texto: r.retomado
            ? `Retomado: ${r.nomeOrdem} · etapa ${r.operacao}`
            : `Iniciado: ${r.nomeOrdem} · etapa ${r.operacao} · ${r.nomeAtividade}`,
        })
      } else if (acao === 'pausar') {
        const r = await api.pausar(corpo)
        setAviso({
          tipo: 'ok',
          texto: `Parado: ${r.nomeOrdem} · etapa ${r.operacao} · ${r.paradaAtual.nomeAtividade}. Use Iniciar para retomar.`,
        })
      } else {
        const r = await api.finalizar(corpo)
        const n = r.apontamentos.length
        setAviso({
          tipo: 'ok',
          texto:
            `Finalizado e gravado no Nomus: ${r.registro.nomeOrdem} · etapa ${r.registro.operacao}` +
            (n > 1 ? ` (${n} apontamentos: produção e paradas)` : ''),
        })
      }
      limpar()
      onMudouAndamento?.()
    } catch (erro) {
      // O recurso tem varias atividades e o .env nao fixou nenhuma. Perguntar aqui e a
      // unica saida: o operador no chao de fabrica nao tem como editar o .env do servidor.
      if (erro.codigo === 'ATIVIDADE_INDEFINIDA' && erro.idRecurso) {
        try {
          const atividades = await api.atividades(erro.idRecurso)
          setEscolhendoAtividade({ atividades, extras })
          setAviso(null)
        } catch (e) {
          setAviso({ tipo: 'erro', texto: `${erro.message} (falha ao listar as atividades: ${e.message})` })
        }
        return
      }

      // A atividade exige um dado que a tela de leitura nao pede por padrao: pergunta agora
      // em vez de recusar o apontamento e perder o tempo ja cronometrado.
      if (erro.codigo === 'QUANTIDADE_OBRIGATORIA' || erro.codigo === 'PERCENTUAL_OBRIGATORIO') {
        const quantidade = erro.codigo === 'QUANTIDADE_OBRIGATORIA'
        setPedindo({
          campo: quantidade ? 'quantidade' : 'percentualProdutoAndamento',
          rotulo: quantidade ? 'Quantidade produzida' : '% concluido',
          valor: '',
          extras,
        })
        setAviso(null)
      } else {
        setAviso({ tipo: 'erro', texto: erro.message })
      }
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Pausar precisa saber QUAL processo esta rodando pra listar os motivos do recurso dele —
   * por isso resolve as etiquetas antes de abrir o modal.
   */
  async function abrirPausa() {
    if (!ordem.trim() || !processo.trim()) {
      setAviso({ tipo: 'erro', texto: 'Leia a ordem de servico e a etapa do processo antes de continuar.' })
      ;(!ordem.trim() ? refOrdem : refProcesso).current?.focus()
      return
    }
    setOcupado(true)
    setAviso(null)
    try {
      const op = await api.resolverOperacao(ordem.trim(), processo.trim())
      const motivos = await api.motivosParada(op.idOperacaoOrdem)
      if (motivos.length === 0) {
        setAviso({
          tipo: 'erro',
          texto:
            'Nenhuma atividade de parada cadastrada neste recurso do Nomus. Cadastre as paradas (refeição, quebra de máquina...) como atividades do recurso.',
        })
        return
      }
      setEscolhendoMotivo({ motivos })
    } catch (erro) {
      setAviso({ tipo: 'erro', texto: erro.message })
    } finally {
      setOcupado(false)
    }
  }

  function escolherMotivo(motivo) {
    setEscolhendoMotivo(null)
    acionar('pausar', { idAtividadeParada: motivo.id })
  }

  function escolherAtividade(atividade) {
    const extras = { ...escolhendoAtividade.extras, idAtividade: atividade.id }
    setEscolhendoAtividade(null)
    acionar('iniciar', extras)
  }

  function confirmarPedido(evento) {
    evento.preventDefault()
    const valor = Number(pedindo.valor)
    if (!Number.isFinite(valor) || (pedindo.campo === 'quantidade' && valor <= 0)) {
      setAviso({ tipo: 'erro', texto: `Informe ${pedindo.rotulo.toLowerCase()}.` })
      return
    }
    const extras = { ...pedindo.extras, [pedindo.campo]: valor }
    setPedindo(null)
    acionar('finalizar', extras)
  }

  const aoTeclar = (proximo) => (evento) => {
    if (evento.key !== 'Enter') return
    evento.preventDefault()
    proximo?.current?.focus()
  }

  const bloqueado =
    ocupado || Boolean(pedindo) || Boolean(escolhendoAtividade) || Boolean(escolhendoMotivo)

  return (
    <>
      <main className="leitura">
        <h1 className="leitura__titulo">APONTAMENTO DE PRODUÇÃO</h1>
        <p className="leitura__subtitulo">
          Utilize o leitor de código de barras para identificar os dados abaixo.
        </p>

        <div className="leitura__linha">
          <div className="leitura__rotulo">
            <span className="leitura__icone">
              <IconeBarcode />
            </span>
            <span>
              <strong>1 - ORDEM DE SERVIÇO</strong>
              <small>Escaneie o código de barras da ordem de serviço</small>
            </span>
          </div>
          <div className="leitura__campo">
            <input
              ref={refOrdem}
              value={ordem}
              onChange={(e) => setOrdem(e.target.value)}
              onKeyDown={aoTeclar(refProcesso)}
              disabled={bloqueado}
              autoComplete="off"
              aria-label="Código de barras da ordem de serviço"
              autoFocus
            />
            <span className="leitura__marca" aria-hidden="true">
              <IconeBarcode />
            </span>
          </div>
        </div>

        <div className="leitura__linha">
          <div className="leitura__rotulo">
            <span className="leitura__icone">
              <IconeProcesso />
            </span>
            <span>
              <strong>2 - ETAPA DO PROCESSO</strong>
              <small>Escaneie o código de barras da etapa do processo</small>
            </span>
          </div>
          <div className="leitura__campo">
            <input
              ref={refProcesso}
              value={processo}
              onChange={(e) => setProcesso(e.target.value)}
              onKeyDown={aoTeclar(refProcesso)}
              disabled={bloqueado}
              autoComplete="off"
              aria-label="Código de barras da etapa do processo"
            />
            <span className="leitura__marca" aria-hidden="true">
              <IconeProcesso />
            </span>
          </div>
        </div>

        <div className="leitura__acoes">
          <button className="botao botao--iniciar" onClick={() => acionar('iniciar')} disabled={bloqueado}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none" />
            </svg>
            {ocupado ? 'AGUARDE...' : 'INICIAR PROCESSO'}
          </button>

          <button className="botao botao--pausar" onClick={abrirPausa} disabled={bloqueado}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M10 8.5v7M14 8.5v7" strokeLinecap="round" />
            </svg>
            {ocupado ? 'AGUARDE...' : 'PAUSAR PROCESSO'}
          </button>

          <button
            className="botao botao--finalizar"
            /* Carimba o instante do toque: se a atividade pedir quantidade, os segundos
               gastos digitando nao podem entrar como tempo produzido. */
            onClick={() => acionar('finalizar', { instanteFinal: agoraLocalISO() })}
            disabled={bloqueado}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
            </svg>
            {ocupado ? 'AGUARDE...' : 'FINALIZAR PROCESSO'}
          </button>
        </div>

        {aviso && (
          <p className={`aviso aviso--${aviso.tipo}`} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>
            {aviso.texto}
          </p>
        )}

        <p className="leitura__nota">
          Operador: <strong>{terminal.funcionario.nome}</strong> · matrícula {terminal.funcionario.matricula}
        </p>
      </main>

      {escolhendoMotivo && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Motivo da parada">
          <div className="modal__caixa">
            <h2 className="modal__titulo">Por que está parando?</h2>
            <p className="modal__texto">
              O tempo parado não conta como produção. Ele é gravado no Nomus com este motivo,
              separado do tempo produzido.
            </p>
            <div className="escolha escolha--modal">
              {escolhendoMotivo.motivos.map((m) => (
                <button key={m.id} className="escolha__opcao" onClick={() => escolherMotivo(m)}>
                  <strong>{m.nome}</strong>
                </button>
              ))}
            </div>
            <div className="modal__acoes">
              <button className="botao botao--neutro" onClick={() => setEscolhendoMotivo(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {escolhendoAtividade && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Escolha a atividade">
          <div className="modal__caixa">
            <h2 className="modal__titulo">Qual atividade?</h2>
            <p className="modal__texto">
              Esta estação tem mais de uma atividade. Escolha a que descreve o que será feito agora.
            </p>
            <div className="escolha escolha--modal">
              {escolhendoAtividade.atividades.map((a) => (
                <button key={a.id} className="escolha__opcao" onClick={() => escolherAtividade(a)}>
                  <strong>{a.nome}</strong>
                  {a.aptQtdProduzida && <small>pede quantidade ao finalizar</small>}
                </button>
              ))}
            </div>
            <div className="modal__acoes">
              <button className="botao botao--neutro" onClick={() => setEscolhendoAtividade(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {pedindo && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={pedindo.rotulo}>
          <form className="modal__caixa" onSubmit={confirmarPedido}>
            <h2 className="modal__titulo">{pedindo.rotulo}</h2>
            <p className="modal__texto">
              A atividade desta etapa exige este dado para gravar o apontamento no Nomus. O tempo já
              cronometrado está guardado.
            </p>
            <input
              ref={refQuantidade}
              className="modal__entrada"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={pedindo.valor}
              onChange={(e) => setPedindo((p) => ({ ...p, valor: e.target.value }))}
            />
            <div className="modal__acoes">
              <button type="button" className="botao botao--neutro" onClick={() => setPedindo(null)}>
                Cancelar
              </button>
              <button type="submit" className="botao botao--finalizar">
                Confirmar e finalizar
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
