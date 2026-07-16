import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import Logo from './components/Logo.jsx'
import Relogio from './components/Relogio.jsx'
import TelaLeitura from './components/TelaLeitura.jsx'
import TelaKanban from './components/TelaKanban.jsx'

export default function App() {
  const [tela, setTela] = useState('leitura')
  const [terminal, setTerminal] = useState(null)
  const [erroBoot, setErroBoot] = useState(null)
  const [versaoAndamento, setVersaoAndamento] = useState(0)

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

  // Finalizar um processo muda o kanban (o card anda de coluna): forca a releitura.
  const aoMudarAndamento = useCallback(() => setVersaoAndamento((v) => v + 1), [])

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

  return (
    <div className="app">
      <header className="cabecalho">
        <Logo />

        <nav className="abas">
          <button
            className={`aba ${tela === 'leitura' ? 'aba--ativa' : ''}`}
            onClick={() => setTela('leitura')}
          >
            Apontamento
          </button>
          <button
            className={`aba ${tela === 'kanban' ? 'aba--ativa' : ''}`}
            onClick={() => setTela('kanban')}
          >
            Acompanhamento
          </button>
        </nav>

        <Relogio />
      </header>

      {tela === 'leitura' ? (
        <TelaLeitura terminal={terminal} onMudouAndamento={aoMudarAndamento} />
      ) : (
        <TelaKanban recarregarEm={versaoAndamento} />
      )}
    </div>
  )
}
