import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { api } from '../api.js'

const AuthContext = createContext(null)

/**
 * Sessao da intranet — busca o usuario logado uma vez no boot (cookie httpOnly, ver
 * server/auth.js) e guarda em contexto pro resto do app: menu, telas protegidas, etc.
 */
export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false
    api.auth
      .eu()
      .then((r) => !cancelado && setUsuario(r.usuario))
      .catch(() => !cancelado && setUsuario(null))
      .finally(() => !cancelado && setCarregando(false))
    return () => {
      cancelado = true
    }
  }, [])

  const login = useCallback(async (email, senha) => {
    const { usuario: logado } = await api.auth.login(email, senha)
    setUsuario(logado)
    return logado
  }, [])

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => {})
    setUsuario(null)
  }, [])

  return (
    <AuthContext.Provider value={{ usuario, carregando, login, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const contexto = useContext(AuthContext)
  if (!contexto) throw new Error('useAuth precisa estar dentro de <AuthProvider>.')
  return contexto
}

/**
 * Guarda de rota: sem login manda pra /login; logado mas sem o modulo mostra aviso de
 * acesso negado em vez de tela em branco. Usado como elemento de rota "pai" (ver App.jsx),
 * as rotas filhas renderizam no <Outlet/>.
 */
export function RotaProtegida({ modulo }) {
  const { usuario, carregando } = useAuth()
  const local = useLocation()

  if (carregando) return null // evita "flash" de tela de login antes do /api/auth/eu responder

  if (!usuario) return <Navigate to="/login" state={{ de: local.pathname }} replace />

  if (modulo && !usuario.modulos.includes(modulo)) {
    return (
      <main className="acesso-negado">
        <h1>Acesso restrito</h1>
        <p>Seu usuário ({usuario.nome}) não tem acesso a este módulo. Fale com um administrador se precisar dele.</p>
      </main>
    )
  }

  return <Outlet />
}
