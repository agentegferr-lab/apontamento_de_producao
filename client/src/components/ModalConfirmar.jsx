import { useEffect, useRef } from 'react'

/**
 * Modal de confirmação genérico (título + mensagem + Cancelar/Confirmar) — reaproveita
 * .modal/.modal__caixa já usados por ModalSenha. O foco vai pro botão "Cancelar" ao abrir (a
 * ação menos destrutiva por padrão) e Escape fecha como se tivesse cancelado.
 */
export default function ModalConfirmar({
  titulo,
  mensagem,
  textoCancelar = 'Cancelar',
  textoConfirmar = 'Confirmar',
  textoConfirmando = 'Processando...',
  confirmando = false,
  onConfirmar,
  onCancelar,
}) {
  const cancelarRef = useRef(null)

  useEffect(() => {
    cancelarRef.current?.focus()
    function aoTeclar(e) {
      if (e.key === 'Escape') onCancelar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [onCancelar])

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} onClick={onCancelar}>
      <div className="modal__caixa" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__titulo">{titulo}</h2>
        <p className="modal__texto">{mensagem}</p>
        <div className="modal__acoes">
          <button ref={cancelarRef} type="button" className="botao botao--neutro" onClick={onCancelar} disabled={confirmando}>
            {textoCancelar}
          </button>
          <button type="button" className="botao botao--perigo" onClick={onConfirmar} disabled={confirmando}>
            {confirmando ? textoConfirmando : textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
