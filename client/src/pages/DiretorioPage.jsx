import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'

export default function DiretorioPage() {
  const [pessoas, setPessoas] = useState(null)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    api
      .diretorio()
      .then(setPessoas)
      .catch((e) => setErro(e.message))
  }, [])

  const filtradas = useMemo(() => {
    if (!pessoas) return []
    const alvo = busca.trim().toLowerCase()
    if (!alvo) return pessoas
    return pessoas.filter((p) =>
      [p.nome, p.setor, p.cargo, p.email].filter(Boolean).some((campo) => campo.toLowerCase().includes(alvo)),
    )
  }, [pessoas, busca])

  return (
    <main className="pagina">
      <div className="pagina__cabecalho">
        <h1>Diretório de contatos</h1>
        <input
          className="kanban__busca"
          placeholder="Buscar por nome, setor, cargo..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {erro && (
        <p className="aviso aviso--erro" role="alert">
          {erro}
        </p>
      )}

      {!pessoas ? (
        <p className="pagina__vazio">Carregando...</p>
      ) : filtradas.length === 0 ? (
        <p className="pagina__vazio">Ninguém encontrado.</p>
      ) : (
        <div className="diretorio__grade">
          {filtradas.map((p) => (
            <article key={p.id} className="diretorio__cartao">
              <h2>{p.nome}</h2>
              <p className="diretorio__cargo">{[p.cargo, p.setor].filter(Boolean).join(' · ') || p.papelNome}</p>
              <dl className="diretorio__dados">
                <div>
                  <dt>E-mail</dt>
                  <dd>{p.email}</dd>
                </div>
                {p.ramal && (
                  <div>
                    <dt>Ramal</dt>
                    <dd>{p.ramal}</dd>
                  </div>
                )}
              </dl>
            </article>
          ))}
        </div>
      )}
    </main>
  )
}
