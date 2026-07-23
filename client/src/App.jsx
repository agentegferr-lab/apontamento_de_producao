import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import Logo from './components/Logo.jsx'
import Relogio from './components/Relogio.jsx'
import TelaLeitura from './components/TelaLeitura.jsx'
import TelaKanban from './components/TelaKanban.jsx'
import TelaPlanejamento from './components/TelaPlanejamento.jsx'
import ModalSenha from './components/ModalSenha.jsx'

// So um freio, nao seguranca de verdade (fica no bundle do cliente) — ver ModalSenha.jsx.
const SENHA_PLANEJAMENTO = 'Adm@2026'
const CHAVE_SESSAO = 'planejamento-liberado'

export default function App() {
  const [tela, setTela] = useState('leitura')
  const [terminal, setTerminal] = useState(null)
  const [erroBoot, setErroBoot] = useState(null)
  const [versaoAndamento, setVersaoAndamento] = useState(0)
  // Liberado uma vez por sessao do navegador (sessionStorage) — nao pede nas trocas de aba
  // seguintes, so de novo se a aba/navegador fechar.
  const [planejamentoLiberado, setPlanejamentoLiberado] = useState(
    () => sessionStorage.getItem(CHAVE_SESSAO) === '1',
  )
  const [pedindoSenha, setPedindoSenha] = useState(false)
  const [senhaErrada, setSenhaErrada] = useState(false)

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

  function abrirPlanejamento() {
    if (planejamentoLiberado) {
      setTela('planejamento')
    } else {
      setSenhaErrada(false)
      setPedindoSenha(true)
    }
  }

  function confirmarSenha(senha) {
    if (senha === SENHA_PLANEJAMENTO) {
      sessionStorage.setItem(CHAVE_SESSAO, '1')
      setPlanejamentoLiberado(true)
      setPedindoSenha(false)
      setTela('planejamento')
    } else {
      setSenhaErrada(true)
    }
  }

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
          <button
            className={`aba ${tela === 'planejamento' ? 'aba--ativa' : ''}`}
            onClick={abrirPlanejamento}
          >
            Planejamento
          </button>
        </nav>

        <Relogio />
      </header>

      {tela === 'leitura' && <TelaLeitura terminal={terminal} onMudouAndamento={aoMudarAndamento} />}
      {tela === 'kanban' && <TelaKanban recarregarEm={versaoAndamento} />}
      {tela === 'planejamento' && planejamentoLiberado && <TelaPlanejamento />}

      {pedindoSenha && (
        <ModalSenha erro={senhaErrada} onConfirmar={confirmarSenha} onCancelar={() => setPedindoSenha(false)} />
      )}
    </div>
  )
}
