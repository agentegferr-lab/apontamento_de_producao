import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function MuralPage() {
  const [avisos, setAvisos] = useState(null)
  const [erro, setErro] = useState(null)
  const [formAberto, setFormAberto] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [corpo, setCorpo] = useState('')
  const [fixado, setFixado] = useState(false)
  const [enviando, setEnviando] = useState(false)

  async function carregar() {
    try {
      setAvisos(await api.avisos.listar())
      setErro(null)
    } catch (e) {
      setErro(e.message)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  async function publicar(evento) {
    evento.preventDefault()
    if (!titulo.trim() || !corpo.trim()) return
    setEnviando(true)
    try {
      await api.avisos.criar({ titulo: titulo.trim(), corpo: corpo.trim(), fixado })
      setTitulo('')
      setCorpo('')
      setFixado(false)
      setFormAberto(false)
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setEnviando(false)
    }
  }

  async function remover(id) {
    if (!confirm('Remover este aviso?')) return
    try {
      await api.avisos.remover(id)
      await carregar()
    } catch (e) {
      setErro(e.message)
    }
  }

  return (
    <main className="pagina">
      <div className="pagina__cabecalho">
        <h1>Mural de avisos</h1>
        <button className="botao botao--iniciar botao--pequeno" onClick={() => setFormAberto((v) => !v)}>
          {formAberto ? 'Cancelar' : 'Novo aviso'}
        </button>
      </div>

      {erro && (
        <p className="aviso aviso--erro" role="alert">
          {erro}
        </p>
      )}

      {formAberto && (
        <form className="mural__form" onSubmit={publicar}>
          <input
            className="modal__campo"
            placeholder="Título"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            autoFocus
          />
          <textarea
            className="mural__texto-campo"
            placeholder="Escreva o aviso..."
            rows={4}
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
          />
          <label className="mural__fixar">
            <input type="checkbox" checked={fixado} onChange={(e) => setFixado(e.target.checked)} />
            Fixar no topo
          </label>
          <button type="submit" className="botao botao--iniciar" disabled={enviando}>
            {enviando ? 'Publicando...' : 'Publicar'}
          </button>
        </form>
      )}

      {!avisos ? (
        <p className="pagina__vazio">Carregando...</p>
      ) : avisos.length === 0 ? (
        <p className="pagina__vazio">Nenhum aviso ainda.</p>
      ) : (
        <div className="mural__lista">
          {avisos.map((a) => (
            <article key={a.id} className={`mural__item ${a.fixado ? 'mural__item--fixado' : ''}`}>
              <div className="mural__item-cabecalho">
                <h2>{a.titulo}</h2>
                {a.fixado && <span className="mural__selo">Fixado</span>}
              </div>
              <p className="mural__corpo">{a.corpo}</p>
              <div className="mural__rodape">
                <span>
                  {a.autorNome} · {new Date(a.criadoEm).toLocaleString('pt-BR')}
                </span>
                <button className="botao botao--perigo botao--pequeno" onClick={() => remover(a.id)}>
                  Remover
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  )
}
