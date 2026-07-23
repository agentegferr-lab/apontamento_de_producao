import { useEffect, useState } from 'react'
import { api } from '../../api.js'

const VAZIO = {
  nome: '',
  email: '',
  senha: '',
  papelId: '',
  matriculaNomus: '',
  setor: '',
  cargo: '',
  ramal: '',
}

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState(null)
  const [papeis, setPapeis] = useState(null)
  const [erro, setErro] = useState(null)
  const [editandoId, setEditandoId] = useState(null) // null = fechado, 'novo' = criando
  const [form, setForm] = useState(VAZIO)
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    try {
      const [listaUsuarios, listaPapeis] = await Promise.all([api.usuarios.listar(), api.papeis.listar()])
      setUsuarios(listaUsuarios)
      setPapeis(listaPapeis)
      setErro(null)
    } catch (e) {
      setErro(e.message)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  function abrirNovo() {
    setForm({ ...VAZIO, papelId: papeis?.[0]?.id ?? '' })
    setEditandoId('novo')
  }

  function abrirEdicao(usuario) {
    setForm({
      nome: usuario.nome,
      email: usuario.email,
      senha: '',
      papelId: usuario.papelId,
      matriculaNomus: usuario.matriculaNomus ?? '',
      setor: usuario.setor ?? '',
      cargo: usuario.cargo ?? '',
      ramal: usuario.ramal ?? '',
    })
    setEditandoId(usuario.id)
  }

  async function salvar(evento) {
    evento.preventDefault()
    setSalvando(true)
    setErro(null)
    try {
      const dados = { ...form, papelId: Number(form.papelId) }
      if (editandoId === 'novo') {
        await api.usuarios.criar(dados)
      } else {
        if (!dados.senha) delete dados.senha // edicao: senha em branco = nao trocar
        await api.usuarios.atualizar(editandoId, dados)
      }
      setEditandoId(null)
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function alternarAtivo(usuario) {
    try {
      await api.usuarios.atualizar(usuario.id, { ativo: !usuario.ativo })
      await carregar()
    } catch (e) {
      setErro(e.message)
    }
  }

  return (
    <main className="pagina">
      <div className="pagina__cabecalho">
        <h1>Usuários</h1>
        <button className="botao botao--iniciar botao--pequeno" onClick={abrirNovo}>
          Novo usuário
        </button>
      </div>

      {erro && (
        <p className="aviso aviso--erro" role="alert">
          {erro}
        </p>
      )}

      {editandoId && (
        <form className="usuarios__form" onSubmit={salvar}>
          <h2>{editandoId === 'novo' ? 'Novo usuário' : 'Editar usuário'}</h2>
          <div className="usuarios__grade-campos">
            <label>
              Nome
              <input
                className="modal__campo"
                required
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              />
            </label>
            <label>
              E-mail
              <input
                className="modal__campo"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label>
              {editandoId === 'novo' ? 'Senha' : 'Nova senha (deixe em branco pra manter)'}
              <input
                className="modal__campo"
                type="password"
                required={editandoId === 'novo'}
                value={form.senha}
                onChange={(e) => setForm((f) => ({ ...f, senha: e.target.value }))}
              />
            </label>
            <label>
              Papel
              <select
                className="seletor"
                required
                value={form.papelId}
                onChange={(e) => setForm((f) => ({ ...f, papelId: e.target.value }))}
              >
                {papeis?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Matrícula Nomus
              <input
                className="modal__campo"
                value={form.matriculaNomus}
                onChange={(e) => setForm((f) => ({ ...f, matriculaNomus: e.target.value }))}
              />
            </label>
            <label>
              Setor
              <input
                className="modal__campo"
                value={form.setor}
                onChange={(e) => setForm((f) => ({ ...f, setor: e.target.value }))}
              />
            </label>
            <label>
              Cargo
              <input
                className="modal__campo"
                value={form.cargo}
                onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))}
              />
            </label>
            <label>
              Ramal
              <input
                className="modal__campo"
                value={form.ramal}
                onChange={(e) => setForm((f) => ({ ...f, ramal: e.target.value }))}
              />
            </label>
          </div>
          <div className="modal__acoes">
            <button type="button" className="botao botao--neutro" onClick={() => setEditandoId(null)}>
              Cancelar
            </button>
            <button type="submit" className="botao botao--iniciar" disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}

      {!usuarios ? (
        <p className="pagina__vazio">Carregando...</p>
      ) : (
        <div className="usuarios__tabela-wrap">
          <table className="usuarios__tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Papel</th>
                <th>Setor</th>
                <th>Matrícula</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className={u.ativo ? '' : 'usuarios__linha--inativa'}>
                  <td>{u.nome}</td>
                  <td>{u.email}</td>
                  <td>{u.papelNome}</td>
                  <td>{u.setor ?? '—'}</td>
                  <td>{u.matriculaNomus ?? '—'}</td>
                  <td>{u.ativo ? 'Ativo' : 'Inativo'}</td>
                  <td className="usuarios__acoes">
                    <button className="botao botao--neutro botao--pequeno" onClick={() => abrirEdicao(u)}>
                      Editar
                    </button>
                    <button
                      className={`botao botao--pequeno ${u.ativo ? 'botao--perigo' : 'botao--iniciar'}`}
                      onClick={() => alternarAtivo(u)}
                    >
                      {u.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
