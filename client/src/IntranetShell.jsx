import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext.jsx'
import { ITENS_MENU } from './modulos.js'
import Logo from './components/Logo.jsx'
import Relogio from './components/Relogio.jsx'

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
        <Logo />

        <nav className="lateral__nav">
          {ITENS_MENU.filter((item) => usuario.modulos.includes(item.chave)).map((item) => (
            <NavLink
              key={item.chave}
              to={item.rota}
              end={item.rota === '/'}
              className={({ isActive }) => `lateral__item ${isActive ? 'lateral__item--ativo' : ''}`}
            >
              {item.rotulo}
            </NavLink>
          ))}
        </nav>

        <div className="lateral__rodape">
          <Relogio />
          <span className="lateral__usuario">
            {usuario.nome}
            <small>{usuario.papel.nome}</small>
          </span>
          <button className="botao botao--neutro botao--pequeno" onClick={sair}>
            Sair
          </button>
        </div>
      </aside>

      <div className="conteudo">
        <Outlet />
      </div>
    </div>
  )
}
