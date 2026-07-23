import { useEffect, useState } from 'react'
import { api } from '../api.js'
import Logo from '../components/Logo.jsx'
import TelaLeitura from '../components/TelaLeitura.jsx'

/** Busca o funcionario/limite do terminal (server/index.js, /api/terminal) antes de liberar a leitura. */
export default function PaginaApontamento() {
  const [terminal, setTerminal] = useState(null)
  const [erroBoot, setErroBoot] = useState(null)

  useEffect(() => {
    let cancelado = false
    api
      .terminal()
      .then((dados) => !cancelado && (setTerminal(dados), setErroBoot(null)))
      .catch((erro) => !cancelado && setErroBoot(erro.message))
    return () => {
      cancelado = true
    }
  }, [])

  if (erroBoot) {
    return (
      <div className="boot">
        <Logo />
        <h1 className="boot__titulo">Terminal sem conexão com o Nomus</h1>
        <p className="boot__texto">{erroBoot}</p>
        <p className="boot__dica">
          Os apontamentos já iniciados estão guardados no servidor do terminal e não se perdem — eles
          voltam assim que a conexão retornar.
        </p>
        <button className="botao botao--iniciar" onClick={() => location.reload()}>
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!terminal) {
    return (
      <div className="boot">
        <Logo />
        <p className="boot__texto">Conectando ao Nomus...</p>
      </div>
    )
  }

  return <TelaLeitura terminal={terminal} />
}
