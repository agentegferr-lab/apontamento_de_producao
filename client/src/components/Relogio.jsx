import { useEffect, useState } from 'react'

/**
 * Data e hora do cabecalho.
 *
 * Componente proprio de proposito: o tique de 1 segundo vive aqui dentro. Se o estado
 * ficasse no App, cada segundo re-renderizaria a arvore toda — inclusive o kanban com todos
 * os cards.
 */
export default function Relogio() {
  const [agora, setAgora] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="relogio">
      <span className="relogio__item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
        </svg>
        {agora.toLocaleDateString('pt-BR')}
      </span>
      <span className="relogio__separador" />
      <span className="relogio__item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
        {agora.toLocaleTimeString('pt-BR')}
      </span>
    </div>
  )
}
