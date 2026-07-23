import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'

function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function DocumentosPage() {
  const [documentos, setDocumentos] = useState(null)
  const [erro, setErro] = useState(null)
  const [pasta, setPasta] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function carregar() {
    try {
      setDocumentos(await api.documentos.listar())
      setErro(null)
    } catch (e) {
      setErro(e.message)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  async function enviar(evento) {
    evento.preventDefault()
    const arquivo = evento.target.elements.arquivo.files?.[0]
    if (!arquivo) return
    setEnviando(true)
    setErro(null)
    try {
      await api.documentos.enviar(arquivo, pasta.trim())
      setPasta('')
      evento.target.reset()
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setEnviando(false)
    }
  }

  async function remover(id) {
    if (!confirm('Remover este documento?')) return
    try {
      await api.documentos.remover(id)
      await carregar()
    } catch (e) {
      setErro(e.message)
    }
  }

  const porPasta = useMemo(() => {
    const grupos = new Map()
    for (const doc of documentos ?? []) {
      if (!grupos.has(doc.pasta)) grupos.set(doc.pasta, [])
      grupos.get(doc.pasta).push(doc)
    }
    return grupos
  }, [documentos])

  return (
    <main className="pagina">
      <div className="pagina__cabecalho">
        <h1>Documentos</h1>
      </div>

      {erro && (
        <p className="aviso aviso--erro" role="alert">
          {erro}
        </p>
      )}

      <form className="documentos__form" onSubmit={enviar}>
        <input type="file" name="arquivo" required />
        <input
          className="modal__campo documentos__pasta"
          placeholder="Pasta (opcional, ex.: Manuais)"
          value={pasta}
          onChange={(e) => setPasta(e.target.value)}
        />
        <button type="submit" className="botao botao--iniciar botao--pequeno" disabled={enviando}>
          {enviando ? 'Enviando...' : 'Enviar'}
        </button>
      </form>

      {!documentos ? (
        <p className="pagina__vazio">Carregando...</p>
      ) : documentos.length === 0 ? (
        <p className="pagina__vazio">Nenhum documento ainda.</p>
      ) : (
        [...porPasta.entries()].map(([nomePasta, itens]) => (
          <section key={nomePasta} className="documentos__pasta-secao">
            <h2>{nomePasta}</h2>
            <ul className="documentos__lista">
              {itens.map((d) => (
                <li key={d.id} className="documentos__item">
                  <a href={api.documentos.urlArquivo(d.id)} className="documentos__nome">
                    {d.nome}
                  </a>
                  <span className="documentos__meta">
                    {formatarTamanho(d.tamanho)} · enviado por {d.enviadoPorNome} em{' '}
                    {new Date(d.criadoEm).toLocaleDateString('pt-BR')}
                  </span>
                  <button className="botao botao--perigo botao--pequeno" onClick={() => remover(d.id)}>
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  )
}
