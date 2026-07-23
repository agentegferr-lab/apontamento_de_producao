import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import Logo from '../components/Logo.jsx'

export default function LoginPage() {
  const { login } = useAuth()
  const navegar = useNavigate()
  const local = useLocation()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  async function entrar(evento) {
    evento.preventDefault()
    setOcupado(true)
    setErro(null)
    try {
      await login(email, senha)
      navegar(local.state?.de ?? '/', { replace: true })
    } catch (e) {
      setErro(e.message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="login">
      <form className="login__caixa" onSubmit={entrar}>
        <Logo />
        <h1 className="login__titulo">Intranet</h1>
        <p className="login__subtitulo">Entre com seu e-mail e senha.</p>

        <label className="login__rotulo" htmlFor="login-email">
          E-mail
        </label>
        <input
          id="login-email"
          className="modal__campo"
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="login__rotulo" htmlFor="login-senha">
          Senha
        </label>
        <input
          id="login-senha"
          className="modal__campo"
          type="password"
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />

        {erro && (
          <p className="aviso aviso--erro" role="alert">
            {erro}
          </p>
        )}

        <button type="submit" className="botao botao--iniciar login__entrar" disabled={ocupado}>
          {ocupado ? 'ENTRANDO...' : 'ENTRAR'}
        </button>
      </form>
    </div>
  )
}
