import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RotaProtegida, useAuth } from './auth/AuthContext.jsx'
import { ITENS_MENU } from './modulos.js'
import IntranetShell from './IntranetShell.jsx'
import LoginPage from './pages/LoginPage.jsx'
import MuralPage from './pages/MuralPage.jsx'
import DiretorioPage from './pages/DiretorioPage.jsx'
import DocumentosPage from './pages/DocumentosPage.jsx'
import UsuariosPage from './pages/admin/UsuariosPage.jsx'
import PaginaApontamento from './pages/PaginaApontamento.jsx'
import TelaKanban from './components/TelaKanban.jsx'
import TelaPlanejamento from './components/TelaPlanejamento.jsx'

/**
 * "/" e o Mural quando o usuario tem o modulo; senao manda pro primeiro modulo que ele
 * tiver (papel customizado sem avisos, por exemplo) em vez de uma tela de acesso negado
 * logo na entrada.
 */
function PaginaInicial() {
  const { usuario } = useAuth()
  if (usuario.modulos.includes('avisos')) return <MuralPage />

  const primeiro = ITENS_MENU.find((item) => item.rota !== '/' && usuario.modulos.includes(item.chave))
  if (primeiro) return <Navigate to={primeiro.rota} replace />

  return (
    <main className="acesso-negado">
      <h1>Nenhum módulo liberado</h1>
      <p>Seu usuário ainda não tem nenhum módulo liberado. Fale com um administrador.</p>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RotaProtegida />}>
            <Route element={<IntranetShell />}>
              <Route path="/" element={<PaginaInicial />} />

              <Route element={<RotaProtegida modulo="diretorio" />}>
                <Route path="/diretorio" element={<DiretorioPage />} />
              </Route>
              <Route element={<RotaProtegida modulo="documentos" />}>
                <Route path="/documentos" element={<DocumentosPage />} />
              </Route>
              <Route element={<RotaProtegida modulo="admin.usuarios" />}>
                <Route path="/admin/usuarios" element={<UsuariosPage />} />
              </Route>
              <Route element={<RotaProtegida modulo="terminal.apontamento" />}>
                <Route path="/terminal/apontamento" element={<PaginaApontamento />} />
              </Route>
              <Route element={<RotaProtegida modulo="terminal.acompanhamento" />}>
                <Route path="/terminal/acompanhamento" element={<TelaKanban />} />
              </Route>
              <Route element={<RotaProtegida modulo="terminal.planejamento" />}>
                <Route path="/terminal/planejamento" element={<TelaPlanejamento />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
