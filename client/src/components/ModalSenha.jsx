import { useState } from 'react'

/**
 * Pede uma senha antes de liberar uma tela — usado pelo Planejamento (ver App.jsx).
 * A senha fica no bundle do cliente: nao e seguranca de verdade, so um freio pra quem
 * nao deveria mexer no calendario nao entrar sem querer. Nao guarda nada sensivel atras
 * dela por causa disso.
 */
export default function ModalSenha({ erro, onConfirmar, onCancelar }) {
  const [senha, setSenha] = useState('')

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Senha necessária" onClick={onCancelar}>
      <div className="modal__caixa" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__titulo">Acesso restrito</h2>
        <p className="modal__texto">Digite a senha para abrir o Planejamento.</p>
        <input
          type="password"
          className="modal__campo"
          autoFocus
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirmar(senha)
          }}
          placeholder="Senha"
        />
        {erro && (
          <p className="aviso aviso--erro" role="alert">
            Senha incorreta.
          </p>
        )}
        <div className="modal__acoes">
          <button className="botao botao--neutro" onClick={onCancelar}>
            Cancelar
          </button>
          <button className="botao botao--iniciar" onClick={() => onConfirmar(senha)}>
            Entrar
          </button>
        </div>
      </div>
    </div>
  )
}
