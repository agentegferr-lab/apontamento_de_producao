import { useState } from 'react'

/**
 * Entrada da sugestao de planejamento por IA — objetivo em texto livre + periodo, os dois
 * obrigatorios (a IA precisa de uma janela pra olhar o backlog). O RESULTADO (rascunho)
 * aparece depois num modal separado — ver ModalSugestaoIA.jsx — que e quem de fato agenda,
 * um a um, so o que o usuario marcar.
 */
export default function ModalGerarSugestao({ gerando, onGerar, onFechar }) {
  const [objetivo, setObjetivo] = useState('')
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')

  const podeGerar = Boolean(objetivo.trim() && inicio && fim)

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Gerar sugestão de planejamento com IA"
      onClick={onFechar}
    >
      <div className="modal__caixa" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__titulo">Sugestão de planejamento com IA</h2>
        <p className="modal__texto">
          Descreva o objetivo e o período — a IA sugere quais ordens do backlog agendar, mas nunca
          agenda nada sozinha.
        </p>
        <textarea
          className="modal__campo modal__campo--textarea"
          rows={3}
          placeholder='Ex.: "planejar a semana pra faturar R$ 50.000" ou "priorizar os pedidos mais antigos"'
          value={objetivo}
          onChange={(e) => setObjetivo(e.target.value)}
          autoFocus
        />
        <div className="modal__periodo">
          <label>
            De
            <input
              type="date"
              className="planejamento__filtro-data"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              className="planejamento__filtro-data"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
            />
          </label>
        </div>
        <div className="modal__acoes">
          <button className="botao botao--neutro" onClick={onFechar} disabled={gerando}>
            Cancelar
          </button>
          <button
            className="botao botao--iniciar"
            onClick={() => onGerar({ objetivo, dataInicio: inicio, dataFim: fim })}
            disabled={!podeGerar || gerando}
          >
            {gerando ? 'Pensando...' : 'Gerar sugestão'}
          </button>
        </div>
      </div>
    </div>
  )
}
