import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { formatarDataBr } from '../planejamentoCampos.js'
import { formatarNumeroBr, formatarMoedaNumero } from '../numero.js'
import {
  intervaloDoPeriodo,
  navegarPeriodo,
  filtrarPorPeriodo,
  agruparPorMotorista,
  somarTotais,
} from '../entregasCampos.js'

const SUBABAS = [
  { valor: 'lancar', texto: 'Lançar entrega' },
  { valor: 'relatorio', texto: 'Relatório' },
  { valor: 'cadastro', texto: 'Cadastro' },
]

const MODOS_PERIODO = [
  { valor: 'dia', texto: 'Dia' },
  { valor: 'semana', texto: 'Semana' },
  { valor: 'mes', texto: 'Mês' },
]

function hojeChave() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function TelaEntregas({ adminLiberado, onPedirSenha }) {
  const [subaba, setSubaba] = useState('lancar')
  const [motoristas, setMotoristas] = useState(null)
  const [caminhoes, setCaminhoes] = useState(null)
  const [entregas, setEntregas] = useState(null)
  const [erro, setErro] = useState(null)

  async function carregar() {
    try {
      const [m, c, e] = await Promise.all([api.motoristas.listar(), api.caminhoes.listar(), api.entregas.listar()])
      setMotoristas(m)
      setCaminhoes(c)
      setEntregas(e)
      setErro(null)
    } catch (err) {
      setErro(err.message)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  function abrirSubaba(valor) {
    if (valor === 'cadastro' && !adminLiberado) {
      onPedirSenha()
      return
    }
    setSubaba(valor)
  }

  const carregando = !motoristas || !caminhoes || !entregas

  return (
    <main className="entregas">
      <div className="entregas__topo">
        <div>
          <h1 className="entregas__titulo">ENTREGAS</h1>
          <p className="entregas__subtitulo">Cadastro de caminhões e motoristas, lançamento e relatório de entregas.</p>
        </div>
        <div className="entregas__subabas">
          {SUBABAS.map((s) => (
            <button
              key={s.valor}
              className={`entregas__subaba ${subaba === s.valor ? 'entregas__subaba--ativa' : ''}`}
              onClick={() => abrirSubaba(s.valor)}
            >
              {s.texto}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <p className="aviso aviso--erro" role="alert">
          {erro}
        </p>
      )}

      {carregando && !erro && <p className="entregas__vazio">Carregando...</p>}

      {!carregando && subaba === 'lancar' && (
        <LancarEntrega motoristas={motoristas} caminhoes={caminhoes} onLancado={carregar} onErro={setErro} />
      )}
      {!carregando && subaba === 'cadastro' && adminLiberado && (
        <Cadastro motoristas={motoristas} caminhoes={caminhoes} onMudou={carregar} onErro={setErro} />
      )}
      {!carregando && subaba === 'relatorio' && (
        <Relatorio entregas={entregas} motoristas={motoristas} caminhoes={caminhoes} onMudou={carregar} onErro={setErro} />
      )}
    </main>
  )
}

function LancarEntrega({ motoristas, caminhoes, onLancado, onErro }) {
  const motoristasAtivos = motoristas.filter((m) => m.ativo)
  const caminhoesAtivos = caminhoes.filter((c) => c.ativo)

  const [motoristaId, setMotoristaId] = useState('')
  const [caminhaoId, setCaminhaoId] = useState('')
  const [data, setData] = useState(hojeChave)
  const [pedidoAtual, setPedidoAtual] = useState('')
  const [metragemAtual, setMetragemAtual] = useState('')
  const [valorAtual, setValorAtual] = useState('')
  const [clienteAtual, setClienteAtual] = useState('')
  const [pedidos, setPedidos] = useState([])
  const [enviando, setEnviando] = useState(false)
  const [sucesso, setSucesso] = useState(null)

  function adicionarPedido() {
    const pedido = pedidoAtual.trim()
    if (!pedido) return
    setPedidos((p) => [
      ...p,
      {
        pedido,
        metragem: metragemAtual.trim() ? Number(metragemAtual) : null,
        valor: valorAtual.trim() ? Number(valorAtual) : null,
        cliente: clienteAtual.trim() || null,
      },
    ])
    setPedidoAtual('')
    setMetragemAtual('')
    setValorAtual('')
    setClienteAtual('')
  }

  function removerPedido(indice) {
    setPedidos((p) => p.filter((_, i) => i !== indice))
  }

  async function lancar() {
    onErro(null)
    setSucesso(null)
    if (!motoristaId) return onErro('Escolha o motorista.')
    if (!caminhaoId) return onErro('Escolha o caminhão.')
    if (pedidos.length === 0) return onErro('Adicione ao menos um pedido entregue.')

    setEnviando(true)
    try {
      await api.entregas.lancar({ motoristaId, caminhaoId, data, pedidos })
      setSucesso(`${pedidos.length} pedido(s) lançado(s) com sucesso.`)
      setPedidos([])
      await onLancado()
    } catch (err) {
      onErro(err.message)
    } finally {
      setEnviando(false)
    }
  }

  if (motoristasAtivos.length === 0 || caminhoesAtivos.length === 0) {
    return (
      <p className="entregas__vazio">
        Cadastre ao menos um motorista e um caminhão ativos (aba Cadastro) antes de lançar uma entrega.
      </p>
    )
  }

  return (
    <div className="entregas__painel entregas__painel--estreito">
      <div className="entregas__campo">
        <label htmlFor="entregas-motorista">Motorista</label>
        <select
          id="entregas-motorista"
          className="seletor"
          value={motoristaId}
          onChange={(e) => setMotoristaId(e.target.value)}
        >
          <option value="">Selecione...</option>
          {motoristasAtivos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      </div>

      <div className="entregas__campo">
        <label htmlFor="entregas-caminhao">Caminhão</label>
        <select
          id="entregas-caminhao"
          className="seletor"
          value={caminhaoId}
          onChange={(e) => setCaminhaoId(e.target.value)}
        >
          <option value="">Selecione...</option>
          {caminhoesAtivos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.placa}
              {c.modelo ? ` · ${c.modelo}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="entregas__campo">
        <label htmlFor="entregas-data">Data da entrega</label>
        <input
          id="entregas-data"
          type="date"
          className="planejamento__filtro-data"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />
      </div>

      <div className="entregas__campo">
        <label htmlFor="entregas-pedido">Pedido entregue</label>
        <div className="entregas__linha-adicionar entregas__linha-adicionar--pedido">
          <input
            id="entregas-pedido"
            className="modal__campo entregas__campo-pedido"
            type="text"
            placeholder="Nº do pedido"
            value={pedidoAtual}
            onChange={(e) => setPedidoAtual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionarPedido()}
          />
          <input
            className="modal__campo entregas__campo-metragem"
            type="number"
            step="0.01"
            min="0"
            placeholder="Metragem (m²)"
            value={metragemAtual}
            onChange={(e) => setMetragemAtual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionarPedido()}
          />
          <input
            className="modal__campo entregas__campo-valor"
            type="number"
            step="0.01"
            min="0"
            placeholder="Valor (R$)"
            value={valorAtual}
            onChange={(e) => setValorAtual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionarPedido()}
          />
          <input
            className="modal__campo entregas__campo-cliente"
            type="text"
            placeholder="Cliente (opcional)"
            value={clienteAtual}
            onChange={(e) => setClienteAtual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionarPedido()}
          />
          <button className="botao botao--neutro botao--pequeno" onClick={adicionarPedido} type="button">
            Adicionar
          </button>
        </div>
      </div>

      {pedidos.length > 0 && (
        <ul className="entregas__lista-pedidos">
          {pedidos.map((p, i) => (
            <li key={`${p.pedido}-${i}`}>
              <span>
                <strong>{p.pedido}</strong>
                {p.metragem != null && ` · ${formatarNumeroBr(p.metragem)} m²`}
                {p.valor != null && ` · ${formatarMoedaNumero(p.valor)}`}
                {p.cliente && ` · ${p.cliente}`}
              </span>
              <button
                className="entregas__remover-pedido"
                onClick={() => removerPedido(i)}
                aria-label={`Remover pedido ${p.pedido}`}
                type="button"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {sucesso && <p className="aviso aviso--ok">{sucesso}</p>}

      <button className="botao botao--iniciar" onClick={lancar} disabled={enviando}>
        {enviando ? 'Lançando...' : 'Lançar entrega'}
      </button>
    </div>
  )
}

function Cadastro({ motoristas, caminhoes, onMudou, onErro }) {
  const [nomeMotorista, setNomeMotorista] = useState('')
  const [placaCaminhao, setPlacaCaminhao] = useState('')
  const [modeloCaminhao, setModeloCaminhao] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function adicionarMotorista() {
    if (!nomeMotorista.trim()) return onErro('Informe o nome do motorista.')
    setSalvando(true)
    onErro(null)
    try {
      await api.motoristas.criar({ nome: nomeMotorista })
      setNomeMotorista('')
      await onMudou()
    } catch (err) {
      onErro(err.message)
    } finally {
      setSalvando(false)
    }
  }

  async function adicionarCaminhao() {
    if (!placaCaminhao.trim()) return onErro('Informe a placa do caminhão.')
    setSalvando(true)
    onErro(null)
    try {
      await api.caminhoes.criar({ placa: placaCaminhao, modelo: modeloCaminhao })
      setPlacaCaminhao('')
      setModeloCaminhao('')
      await onMudou()
    } catch (err) {
      onErro(err.message)
    } finally {
      setSalvando(false)
    }
  }

  async function alternarAtivoMotorista(motorista) {
    onErro(null)
    try {
      await api.motoristas.atualizar(motorista.id, { ativo: !motorista.ativo })
      await onMudou()
    } catch (err) {
      onErro(err.message)
    }
  }

  async function alternarAtivoCaminhao(caminhao) {
    onErro(null)
    try {
      await api.caminhoes.atualizar(caminhao.id, { ativo: !caminhao.ativo })
      await onMudou()
    } catch (err) {
      onErro(err.message)
    }
  }

  return (
    <div className="entregas__cadastros">
      <section className="entregas__painel">
        <h2 className="entregas__painel-titulo">Motoristas</h2>
        <div className="entregas__linha-adicionar">
          <input
            className="modal__campo"
            type="text"
            placeholder="Nome do motorista"
            value={nomeMotorista}
            onChange={(e) => setNomeMotorista(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionarMotorista()}
          />
          <button className="botao botao--neutro botao--pequeno" onClick={adicionarMotorista} disabled={salvando}>
            Adicionar
          </button>
        </div>
        <ul className="entregas__lista-cadastro">
          {motoristas.length === 0 && <li className="entregas__lista-cadastro-vazia">Nenhum motorista cadastrado.</li>}
          {motoristas.map((m) => (
            <li key={m.id} className={m.ativo ? '' : 'entregas__item--inativo'}>
              <span>{m.nome}</span>
              <button className="botao botao--neutro botao--pequeno" onClick={() => alternarAtivoMotorista(m)}>
                {m.ativo ? 'Desativar' : 'Reativar'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="entregas__painel">
        <h2 className="entregas__painel-titulo">Caminhões</h2>
        <div className="entregas__linha-adicionar entregas__linha-adicionar--dupla">
          <input
            className="modal__campo"
            type="text"
            placeholder="Placa"
            value={placaCaminhao}
            onChange={(e) => setPlacaCaminhao(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionarCaminhao()}
          />
          <input
            className="modal__campo"
            type="text"
            placeholder="Modelo (opcional)"
            value={modeloCaminhao}
            onChange={(e) => setModeloCaminhao(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionarCaminhao()}
          />
          <button className="botao botao--neutro botao--pequeno" onClick={adicionarCaminhao} disabled={salvando}>
            Adicionar
          </button>
        </div>
        <ul className="entregas__lista-cadastro">
          {caminhoes.length === 0 && <li className="entregas__lista-cadastro-vazia">Nenhum caminhão cadastrado.</li>}
          {caminhoes.map((c) => (
            <li key={c.id} className={c.ativo ? '' : 'entregas__item--inativo'}>
              <span>
                {c.placa}
                {c.modelo ? ` · ${c.modelo}` : ''}
              </span>
              <button className="botao botao--neutro botao--pequeno" onClick={() => alternarAtivoCaminhao(c)}>
                {c.ativo ? 'Desativar' : 'Reativar'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Relatorio({ entregas, motoristas, caminhoes, onMudou, onErro }) {
  const [modo, setModo] = useState('dia')
  const [referencia, setReferencia] = useState(() => new Date())
  const [removendo, setRemovendo] = useState(null) // id da entrega sendo removida agora

  const periodo = useMemo(() => intervaloDoPeriodo(modo, referencia), [modo, referencia])
  const filtradas = useMemo(() => filtrarPorPeriodo(entregas, periodo), [entregas, periodo])
  const porMotorista = useMemo(() => agruparPorMotorista(filtradas, motoristas), [filtradas, motoristas])
  const totais = useMemo(() => somarTotais(filtradas), [filtradas])

  const nomeMotorista = new Map(motoristas.map((m) => [m.id, m.nome]))
  const placaCaminhao = new Map(caminhoes.map((c) => [c.id, c.placa]))

  const ordenadas = [...filtradas].sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm.localeCompare(a.criadoEm))

  async function removerEntrega(item) {
    if (!window.confirm(`Excluir a entrega do pedido ${item.pedido}? Essa ação não pode ser desfeita.`)) return
    setRemovendo(item.id)
    onErro(null)
    try {
      await api.entregas.remover(item.id)
      await onMudou()
    } catch (err) {
      onErro(err.message)
    } finally {
      setRemovendo(null)
    }
  }

  return (
    <div className="entregas__painel">
      <div className="entregas__relatorio-controles">
        <div className="entregas__modos">
          {MODOS_PERIODO.map((m) => (
            <button
              key={m.valor}
              className={`botao botao--neutro botao--pequeno ${modo === m.valor ? 'botao--ativo' : ''}`}
              onClick={() => setModo(m.valor)}
            >
              {m.texto}
            </button>
          ))}
        </div>
        <div className="entregas__navegacao">
          <button className="botao botao--neutro botao--pequeno" onClick={() => setReferencia((r) => navegarPeriodo(modo, r, -1))}>
            ‹
          </button>
          <span className="entregas__periodo-rotulo">{periodo.rotulo}</span>
          <button className="botao botao--neutro botao--pequeno" onClick={() => setReferencia((r) => navegarPeriodo(modo, r, 1))}>
            ›
          </button>
          <button className="botao botao--neutro botao--pequeno" onClick={() => setReferencia(new Date())}>
            Hoje
          </button>
        </div>
      </div>

      <div className="entregas__resumo">
        <div className="entregas__resumo-card">
          <span className="entregas__resumo-valor">{filtradas.length}</span>
          <span className="entregas__resumo-rotulo">Pedidos entregues no período</span>
        </div>
        {totais.metragem > 0 && (
          <div className="entregas__resumo-card">
            <span className="entregas__resumo-valor">{formatarNumeroBr(totais.metragem)} m²</span>
            <span className="entregas__resumo-rotulo">Metragem total</span>
          </div>
        )}
        {totais.valor > 0 && (
          <div className="entregas__resumo-card">
            <span className="entregas__resumo-valor">{formatarMoedaNumero(totais.valor)}</span>
            <span className="entregas__resumo-rotulo">Valor total</span>
          </div>
        )}
        {porMotorista.map((m) => (
          <div className="entregas__resumo-card" key={m.motoristaId}>
            <span className="entregas__resumo-valor">{m.total}</span>
            <span className="entregas__resumo-rotulo">{m.nome}</span>
          </div>
        ))}
      </div>

      {ordenadas.length === 0 ? (
        <p className="entregas__vazio">Nenhuma entrega lançada neste período.</p>
      ) : (
        <div className="entregas__tabela-wrap">
          <table className="entregas__tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Motorista</th>
                <th>Caminhão</th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Metragem</th>
                <th>Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((e) => (
                <tr key={e.id}>
                  <td>{formatarDataBr(e.data)}</td>
                  <td>{nomeMotorista.get(e.motoristaId) ?? '—'}</td>
                  <td>{placaCaminhao.get(e.caminhaoId) ?? '—'}</td>
                  <td>{e.pedido}</td>
                  <td>{e.cliente ?? '—'}</td>
                  <td>{e.metragem != null ? `${formatarNumeroBr(e.metragem)} m²` : '—'}</td>
                  <td>{e.valor != null ? formatarMoedaNumero(e.valor) : '—'}</td>
                  <td>
                    <button
                      className="botao botao--perigo botao--pequeno"
                      onClick={() => removerEntrega(e)}
                      disabled={removendo === e.id}
                    >
                      {removendo === e.id ? 'Removendo...' : 'Excluir'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
