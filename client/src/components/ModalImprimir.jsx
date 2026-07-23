import { useState } from 'react'

/**
 * Escolhe o periodo antes de imprimir o relatorio (ver TelaPlanejamento.jsx, RelatorioImpressao.jsx)
 * — periodo em branco (os dois campos vazios) imprime todas as ordens planejadas, nao so o
 * mes visivel no momento.
 */
export default function ModalImprimir({ onImprimir, onFechar }) {
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Imprimir relatório" onClick={onFechar}>
      <div className="modal__caixa" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__titulo">Imprimir relatório</h2>
        <p className="modal__texto">
          Escolha o período — deixe em branco pra imprimir todas as ordens planejadas.
        </p>
        <div className="modal__periodo">
          <label>
            De
            <input
              type="date"
              className="planejamento__filtro-data"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              autoFocus
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
          <button className="botao botao--neutro" onClick={onFechar}>
            Cancelar
          </button>
          <button className="botao botao--iniciar" onClick={() => onImprimir({ inicio, fim })}>
            Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}
