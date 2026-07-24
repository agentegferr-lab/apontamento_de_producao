import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext.jsx'
import { ITENS_MENU } from './modulos.js'
import Logo from './components/Logo.jsx'
import Relogio from './components/Relogio.jsx'

const ICONES = {
  avisos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0-6 6v3.5L4 16h16l-2-3.5V9a6 6 0 0 0-6-6Z" strokeLinejoin="round" />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" strokeLinecap="round" />
    </svg>
  ),
  diretorio: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M5.5 16c.5-2 1.8-3 3-3s2.5 1 3 3" strokeLinecap="round" />
      <path d="M14 9.5h4M14 13h4" strokeLinecap="round" />
    </svg>
  ),
  'terminal.apontamento': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2" strokeLinecap="round" />
      <path d="M9.5 3h5" strokeLinecap="round" />
    </svg>
  ),
  'terminal.acompanhamento': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="5" width="4" height="9" rx="1" />
      <rect x="10" y="5" width="4" height="14" rx="1" />
      <rect x="16" y="5" width="4" height="6" rx="1" />
    </svg>
  ),
  'terminal.planejamento': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  ),
  'admin.usuarios': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="10" cy="8" r="3" />
      <path d="M4 20c0-3.3 2.7-5.7 6-5.7" strokeLinecap="round" />
      <circle cx="17.5" cy="16.5" r="2.2" />
      <path
        d="M17.5 13v1.1M17.5 18.9V20M14.6 14.6l.8.8M19.6 19.6l.8.8M13.3 16.5h1.1M19.6 16.5h1.1M14.6 18.4l.8-.8M19.6 13.4l.8-.8"
        strokeLinecap="round"
      />
    </svg>
  ),
}

function iniciais(nome) {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join('')
}

/** Preserva a ordem de primeira ocorrencia dos grupos, na ordem em que aparecem em ITENS_MENU. */
function agruparPorGrupo(itens) {
  const grupos = []
  for (const item of itens) {
    let grupo = grupos.find((g) => g.nome === item.grupo)
    if (!grupo) {
      grupo = { nome: item.grupo, itens: [] }
      grupos.push(grupo)
    }
    grupo.itens.push(item)
  }
  return grupos
}

export default function IntranetShell() {
  const { usuario, logout } = useAuth()
  const navegar = useNavigate()

  async function sair() {
    // Navega ANTES de logout(): assim que usuario vira null, o RotaProtegida desta arvore
    // dispara seu proprio redirect pra /login com state.de = rota atual — se isso rodasse
    // primeiro, o proximo login (de outro usuario, com outro papel) voltaria pra uma pagina
    // que ele pode nao ter acesso. Navegando primeiro, a arvore protegida ja desmontou.
    navegar('/login', { replace: true })
    await logout()
  }

  return (
    <div className="app">
      <aside className="lateral">
        <div className="lateral__topo">
          <Logo />
          <span className="lateral__subtitulo">Intranet</span>
        </div>

        <nav className="lateral__nav">
          {agruparPorGrupo(ITENS_MENU.filter((item) => usuario.modulos.includes(item.chave))).map((grupo) => (
            <div className="lateral__grupo" key={grupo.nome}>
              <span className="lateral__secao">{grupo.nome}</span>
              {grupo.itens.map((item) => (
                <NavLink
                  key={item.chave}
                  to={item.rota}
                  end={item.rota === '/'}
                  className={({ isActive }) => `lateral__item ${isActive ? 'lateral__item--ativo' : ''}`}
                >
                  <span className="lateral__icone">{ICONES[item.chave]}</span>
                  {item.rotulo}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="lateral__rodape">
          <Relogio />
          <div className="lateral__perfil">
            <span className="lateral__avatar">{iniciais(usuario.nome)}</span>
            <span className="lateral__perfil-texto">
              <strong>{usuario.nome}</strong>
              <small>{usuario.papel.nome}</small>
            </span>
            <button className="lateral__sair" onClick={sair} title="Sair" aria-label="Sair">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className="conteudo">
        <Outlet />
      </div>
    </div>
  )
}
