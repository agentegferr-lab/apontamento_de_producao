import { useEffect, useRef, useState } from 'react'

/**
 * Menu de ações discreto (3 pontinhos). Usa position:fixed calculado a partir do botão pra não
 * ser cortado por containers com overflow (ex. a tabela de Entregas, que tem scroll horizontal
 * — um dropdown position:absolute dentro dela seria cortado verticalmente também). Fecha no
 * Escape (devolvendo o foco pro gatilho), no clique fora e ao rolar a página.
 */
export default function MenuAcoes({ rotulo, itens }) {
  const [aberto, setAberto] = useState(false)
  const [posicao, setPosicao] = useState(null)
  const botaoRef = useRef(null)
  const menuRef = useRef(null)

  function abrir() {
    const rect = botaoRef.current.getBoundingClientRect()
    setPosicao({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) })
    setAberto(true)
  }

  useEffect(() => {
    if (!aberto) return

    function aoClicarFora(e) {
      if (menuRef.current?.contains(e.target) || botaoRef.current?.contains(e.target)) return
      setAberto(false)
    }
    function aoTeclar(e) {
      if (e.key === 'Escape') {
        setAberto(false)
        botaoRef.current?.focus()
      }
    }
    function aoRolar() {
      setAberto(false)
    }

    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    window.addEventListener('scroll', aoRolar, true)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
      window.removeEventListener('scroll', aoRolar, true)
    }
  }, [aberto])

  return (
    <div className="menu-acoes">
      <button
        ref={botaoRef}
        type="button"
        className="menu-acoes__gatilho"
        aria-label={`Ações${rotulo ? ` para ${rotulo}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => (aberto ? setAberto(false) : abrir())}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {aberto && posicao && (
        <div ref={menuRef} role="menu" className="menu-acoes__lista" style={{ top: posicao.top, right: posicao.right }}>
          {itens.map((item) => (
            <button
              key={item.texto}
              type="button"
              role="menuitem"
              className={`menu-acoes__item ${item.perigo ? 'menu-acoes__item--perigo' : ''}`}
              onClick={() => {
                setAberto(false)
                item.aoClicar()
              }}
            >
              {item.texto}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
