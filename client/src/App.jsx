import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import Logo from './components/Logo.jsx'
import Relogio from './components/Relogio.jsx'
import TelaLeitura from './components/TelaLeitura.jsx'
import TelaKanban from './components/TelaKanban.jsx'
import TelaPlanejamento from './components/TelaPlanejamento.jsx'
import TelaEntregas from './components/TelaEntregas.jsx'
import TelaRelatorioProducao from './components/TelaRelatorioProducao.jsx'
import ModalSenha from './components/ModalSenha.jsx'

// So um freio, nao seguranca de verdade (fica no bundle do cliente) — ver ModalSenha.jsx.
// Mesma senha protege o Planejamento e o Cadastro de caminhoes/motoristas dentro de Entregas.
const SENHA_ADMIN = 'Adm@2026'
// So pro Planejamento: entra e ve tudo (calendario, fila, relatorio), mas sem arrastar,
// agendar, reagendar ou remover nada — ver TelaPlanejamento.jsx, prop somenteLeitura.
const SENHA_VISUALIZACAO_PLANEJAMENTO = 'Comercial@gferro'
const CHAVE_SESSAO = 'planejamento-liberado'
const CHAVE_SESSAO_VISUALIZACAO = 'planejamento-visualizacao'

export default function App() {
  const [tela, setTela] = useState('leitura')
  const [terminal, setTerminal] = useState(null)
  const [erroBoot, setErroBoot] = useState(null)
  const [versaoAndamento, setVersaoAndamento] = useState(0)
  // Liberado uma vez por sessao do navegador (sessionStorage) — nao pede nas trocas de aba
  // seguintes, so de novo se a aba/navegador fechar.
  const [adminLiberado, setAdminLiberado] = useState(() => sessionStorage.getItem(CHAVE_SESSAO) === '1')
  const [planejamentoVisualizacao, setPlanejamentoVisualizacao] = useState(
    () => sessionStorage.getItem(CHAVE_SESSAO_VISUALIZACAO) === '1',
  )
  const [pedindoSenha, setPedindoSenha] = useState(false)
  const [senhaErrada, setSenhaErrada] = useState(false)
  // Pra onde ir depois de confirmar a senha — Planejamento troca de aba sozinho; pedido vindo
  // de dentro de Entregas so libera o Cadastro, o usuario ja esta na aba certa.
  const [origemSenha, setOrigemSenha] = useState(null)
  // So aparece/funciona em telas de tablet/celular (ver CSS, @media max-width 880px) — em
  // telas largas as abas ficam sempre visiveis e este estado nunca chega a importar.
  const [menuAberto, setMenuAberto] = useState(false)
  const menuRef = useRef(null)
  const hamburguerRef = useRef(null)

  useEffect(() => {
    if (!menuAberto) return
    function aoClicarFora(e) {
      if (menuRef.current?.contains(e.target) || hamburguerRef.current?.contains(e.target)) return
      setMenuAberto(false)
    }
    function aoTeclar(e) {
      if (e.key === 'Escape') setMenuAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [menuAberto])

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

  // Troca de aba pelo menu (ver nav abaixo) — fecha o hamburguer junto, senao ele fica
  // aberto sobre a tela nova depois de escolher um item.
  function irPara(novaTela) {
    setTela(novaTela)
    setMenuAberto(false)
  }

  function abrirPlanejamento() {
    setMenuAberto(false)
    if (adminLiberado || planejamentoVisualizacao) {
      setTela('planejamento')
    } else {
      setOrigemSenha('planejamento')
      setSenhaErrada(false)
      setPedindoSenha(true)
    }
  }

  function pedirSenhaParaEntregas() {
    setMenuAberto(false)
    setOrigemSenha('entregas')
    setSenhaErrada(false)
    setPedindoSenha(true)
  }

  function confirmarSenha(senha) {
    if (senha === SENHA_ADMIN) {
      sessionStorage.setItem(CHAVE_SESSAO, '1')
      setAdminLiberado(true)
      setPedindoSenha(false)
      if (origemSenha === 'planejamento') setTela('planejamento')
    } else if (origemSenha === 'planejamento' && senha === SENHA_VISUALIZACAO_PLANEJAMENTO) {
      sessionStorage.setItem(CHAVE_SESSAO_VISUALIZACAO, '1')
      setPlanejamentoVisualizacao(true)
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
        {/* Logo+abas agrupados: sem isso, o cabecalho quebrava em 3 linhas separadas (logo /
            abas / relogio) em larguras de tablet — juntos, eles quebram como um bloco so,
            deixando so 2 linhas (logo+abas / relogio) e sobrando mais altura pro conteudo. */}
        <div className="cabecalho__nav">
          <Logo />

          <nav ref={menuRef} className={`abas ${menuAberto ? 'abas--aberta' : ''}`}>
            <button
              className={`aba ${tela === 'leitura' ? 'aba--ativa' : ''}`}
              onClick={() => irPara('leitura')}
            >
              Apontamento
            </button>
            <button
              className={`aba ${tela === 'kanban' ? 'aba--ativa' : ''}`}
              onClick={() => irPara('kanban')}
            >
              Acompanhamento
            </button>
            <button
              className={`aba ${tela === 'planejamento' ? 'aba--ativa' : ''}`}
              onClick={abrirPlanejamento}
            >
              Planejamento
            </button>
            <button
              className={`aba ${tela === 'entregas' ? 'aba--ativa' : ''}`}
              onClick={() => irPara('entregas')}
            >
              Entregas
            </button>
            <button
              className={`aba ${tela === 'relatorio-producao' ? 'aba--ativa' : ''}`}
              onClick={() => irPara('relatorio-producao')}
            >
              Relatório
            </button>
          </nav>
        </div>

        {/* So visivel em tablet/celular (CSS) — em telas largas as abas ja ficam sempre a
            mostra, sem precisar de menu nenhum. */}
        <button
          ref={hamburguerRef}
          type="button"
          className="cabecalho__hamburguer"
          onClick={() => setMenuAberto((v) => !v)}
          aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={menuAberto}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {menuAberto ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>

        <Relogio />
      </header>

      {tela === 'leitura' && <TelaLeitura terminal={terminal} onMudouAndamento={aoMudarAndamento} />}
      {tela === 'kanban' && <TelaKanban recarregarEm={versaoAndamento} />}
      {tela === 'planejamento' && (adminLiberado || planejamentoVisualizacao) && (
        <TelaPlanejamento somenteLeitura={!adminLiberado} />
      )}
      {tela === 'entregas' && <TelaEntregas adminLiberado={adminLiberado} onPedirSenha={pedirSenhaParaEntregas} />}
      {tela === 'relatorio-producao' && <TelaRelatorioProducao />}

      {pedindoSenha && (
        <ModalSenha
          erro={senhaErrada}
          mensagem={
            origemSenha === 'entregas'
              ? 'Digite a senha para abrir o Cadastro de caminhões e motoristas.'
              : 'Digite a senha para abrir o Planejamento.'
          }
          onConfirmar={confirmarSenha}
          onCancelar={() => setPedindoSenha(false)}
        />
      )}
    </div>
  )
}
