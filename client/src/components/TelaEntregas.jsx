import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { formatarDataBr } from '../planejamentoCampos.js'
import { formatarMoedaNumero } from '../numero.js'
import MenuAcoes from './MenuAcoes.jsx'
import ModalConfirmar from './ModalConfirmar.jsx'
import {
  intervaloDoPeriodo,
  navegarPeriodo,
  filtrarPorPeriodo,
  somarTotais,
  motoristasAtivos,
  rankingPorMotorista,
  pluralizar,
  textoRegistros,
  formatarMetragem,
  filtrarPorBusca,
  filtrarPorSelecao,
  paginar,
  gerarCsvEntregas,
} from '../entregasCampos.js'

const MODOS_PERIODO = [
  { valor: 'dia', texto: 'Dia' },
  { valor: 'semana', texto: 'Semana' },
  { valor: 'mes', texto: 'Mês' },
]

const TAMANHO_PAGINA = 10

function chaveDoDia(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function TelaEntregas({ adminLiberado, onPedirSenha }) {
  // 'relatorio' e a visao principal da tela — "Nova entrega"/"Caminhões e motoristas" no
  // cabecalho sao acoes que abrem as outras duas visoes, nao abas de mesmo peso.
  const [subaba, setSubaba] = useState('relatorio')
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
          <h1 className="entregas__titulo">Entregas</h1>
          <p className="entregas__subtitulo">Acompanhe pedidos, motoristas e resultados de entrega.</p>
        </div>
        <div className="entregas__acoes-topo">
          <button type="button" className="botao botao--neutro botao--pequeno" onClick={() => abrirSubaba('cadastro')}>
            Caminhões e motoristas
          </button>
          <button type="button" className="botao botao--neutro botao--pequeno" onClick={() => abrirSubaba('relatorio')}>
            Relatório
          </button>
          <button type="button" className="botao botao--neutro botao--pequeno" onClick={() => abrirSubaba('ranking')}>
            Ranking de motoristas
          </button>
          <button type="button" className="botao botao--amarelo botao--pequeno" onClick={() => abrirSubaba('lancar')}>
            Nova entrega
          </button>
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
      {!carregando && subaba === 'ranking' && <Ranking entregas={entregas} motoristas={motoristas} />}
    </main>
  )
}

function LancarEntrega({ motoristas, caminhoes, onLancado, onErro }) {
  const motoristasAtivosLista = motoristas.filter((m) => m.ativo)
  const caminhoesAtivos = caminhoes.filter((c) => c.ativo)

  const [motoristaId, setMotoristaId] = useState('')
  const [caminhaoId, setCaminhaoId] = useState('')
  const [data, setData] = useState(() => chaveDoDia(new Date()))
  const [pedidoAtual, setPedidoAtual] = useState('')
  const [metragemAtual, setMetragemAtual] = useState('')
  const [valorAtual, setValorAtual] = useState('')
  const [clienteAtual, setClienteAtual] = useState('')
  const [pedidos, setPedidos] = useState([])
  const [enviando, setEnviando] = useState(false)
  const [sucesso, setSucesso] = useState(null)
  const [buscandoPedido, setBuscandoPedido] = useState(false)

  // Ao sair do campo "Pedido", tenta preencher cliente/metragem/valor sozinho com o que ja
  // esta resolvido do Nomus (ver server/pedidos.js, buscarPedidoPorCodigo) — o motorista so
  // digitou o numero. Silencioso quando nao acha (pedido ainda nao resolvido, ou digitado
  // errado): nao trava o lancamento manual, so nao preenche nada.
  async function buscarDadosDoPedido() {
    const codigo = pedidoAtual.trim()
    if (!codigo) return
    setBuscandoPedido(true)
    try {
      const info = await api.buscarPedido(codigo)
      if (info.cliente != null) setClienteAtual(info.cliente)
      if (info.metragem != null) setMetragemAtual(String(info.metragem))
      if (info.valor != null) setValorAtual(String(info.valor))
    } catch {
      // pedido nao encontrado/nao resolvido ainda — segue o form manual, sem erro na tela.
    } finally {
      setBuscandoPedido(false)
    }
  }

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

  if (motoristasAtivosLista.length === 0 || caminhoesAtivos.length === 0) {
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
          {motoristasAtivosLista.map((m) => (
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
            onBlur={buscarDadosDoPedido}
            // Enter aqui so busca (preenche cliente/metragem/valor) — nao adiciona ainda,
            // senao o lancamento ia com os campos vazios (a busca e assincrona, e o
            // Enter nao tira o foco do campo sozinho).
            onKeyDown={(e) => e.key === 'Enter' && buscarDadosDoPedido()}
          />
          {buscandoPedido && <span className="entregas__buscando-pedido">Buscando...</span>}
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
                {p.metragem != null && ` · ${formatarMetragem(p.metragem)}`}
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

/**
 * Controle de período (segmentado Dia/Semana/Mês + navegação + calendário) — usado tanto no
 * Relatório quanto no Ranking de motoristas, extraído pra não duplicar essa marcação (e o
 * comportamento) nos dois lugares.
 */
function SeletorPeriodo({ modo, setModo, referencia, setReferencia, rotulo }) {
  const dataOcultaRef = useRef(null)

  function abrirSeletorDeData() {
    const el = dataOcultaRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.focus()
  }

  return (
    <div className="entregas__relatorio-controles">
      <div className="segmentado" role="group" aria-label="Período">
        {MODOS_PERIODO.map((m) => (
          <button
            key={m.valor}
            type="button"
            className={`segmentado__item ${modo === m.valor ? 'segmentado__item--ativo' : ''}`}
            aria-pressed={modo === m.valor}
            onClick={() => setModo(m.valor)}
          >
            {m.texto}
          </button>
        ))}
      </div>
      <div className="entregas__navegacao">
        <button
          type="button"
          className="botao botao--neutro botao--pequeno botao--icone"
          aria-label="Período anterior"
          onClick={() => setReferencia((r) => navegarPeriodo(modo, r, -1))}
        >
          ‹
        </button>
        <span className="entregas__periodo-rotulo">{rotulo}</span>
        <button
          type="button"
          className="botao botao--neutro botao--pequeno botao--icone"
          aria-label="Próximo período"
          onClick={() => setReferencia((r) => navegarPeriodo(modo, r, 1))}
        >
          ›
        </button>
        <button type="button" className="botao botao--neutro botao--pequeno" onClick={() => setReferencia(new Date())}>
          Hoje
        </button>
        <button
          type="button"
          className="botao botao--neutro botao--pequeno botao--icone"
          aria-label="Escolher uma data"
          onClick={abrirSeletorDeData}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 3v4M16 3v4" />
          </svg>
        </button>
        <input
          ref={dataOcultaRef}
          type="date"
          className="entregas__data-oculta"
          aria-hidden="true"
          tabIndex={-1}
          value={chaveDoDia(referencia)}
          onChange={(e) => e.target.value && setReferencia(new Date(`${e.target.value}T00:00:00`))}
        />
      </div>
    </div>
  )
}

function Relatorio({ entregas, motoristas, caminhoes, onMudou, onErro }) {
  const [modo, setModo] = useState('dia')
  const [referencia, setReferencia] = useState(() => new Date())
  const [busca, setBusca] = useState('')
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [filtroMotoristaId, setFiltroMotoristaId] = useState('')
  const [filtroCaminhaoId, setFiltroCaminhaoId] = useState('')
  const [pagina, setPagina] = useState(1)
  const [entregaParaExcluir, setEntregaParaExcluir] = useState(null)
  const [excluindo, setExcluindo] = useState(false)
  const [sucesso, setSucesso] = useState(null)

  const filtrosPainelRef = useRef(null)
  const filtrosBotaoRef = useRef(null)

  const periodo = useMemo(() => intervaloDoPeriodo(modo, referencia), [modo, referencia])
  const doPeriodo = useMemo(() => filtrarPorPeriodo(entregas, periodo), [entregas, periodo])
  const totais = useMemo(() => somarTotais(doPeriodo), [doPeriodo])
  const ativos = useMemo(() => motoristasAtivos(motoristas), [motoristas])

  const nomeMotorista = useMemo(() => new Map(motoristas.map((m) => [m.id, m.nome])), [motoristas])
  const placaCaminhao = useMemo(() => new Map(caminhoes.map((c) => [c.id, c.placa])), [caminhoes])

  const filtradas = useMemo(() => {
    const porSelecao = filtrarPorSelecao(doPeriodo, { motoristaId: filtroMotoristaId, caminhaoId: filtroCaminhaoId })
    const porBusca = filtrarPorBusca(porSelecao, busca)
    return [...porBusca].sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm.localeCompare(a.criadoEm))
  }, [doPeriodo, filtroMotoristaId, filtroCaminhaoId, busca])

  // Volta pra pagina 1 sempre que o conjunto filtrado muda de base — senao o usuario podia
  // ficar "preso" numa pagina 3 que nao existe mais depois de um filtro reduzir o total.
  useEffect(() => {
    setPagina(1)
  }, [periodo.inicio, periodo.fim, busca, filtroMotoristaId, filtroCaminhaoId])

  const { itens: paginaAtual, totalPaginas } = useMemo(() => paginar(filtradas, pagina, TAMANHO_PAGINA), [filtradas, pagina])

  useEffect(() => {
    if (!filtrosAbertos) return
    function aoClicarFora(e) {
      if (filtrosPainelRef.current?.contains(e.target) || filtrosBotaoRef.current?.contains(e.target)) return
      setFiltrosAbertos(false)
    }
    function aoTeclar(e) {
      if (e.key === 'Escape') setFiltrosAbertos(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [filtrosAbertos])

  function exportarCsv() {
    const csv = gerarCsvEntregas(filtradas, { nomeMotorista, placaCaminhao })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `entregas-${periodo.inicio}-a-${periodo.fim}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function confirmarExclusao() {
    if (!entregaParaExcluir) return
    setExcluindo(true)
    onErro(null)
    try {
      const pedidoExcluido = entregaParaExcluir.pedido
      await api.entregas.remover(entregaParaExcluir.id)
      setEntregaParaExcluir(null)
      setSucesso(`Entrega do pedido ${pedidoExcluido} excluída com sucesso.`)
      await onMudou()
    } catch (err) {
      onErro(err.message)
    } finally {
      setExcluindo(false)
    }
  }

  const filtrosAtivos = Boolean(filtroMotoristaId || filtroCaminhaoId)
  const quantidadeFiltrosAtivos = [filtroMotoristaId, filtroCaminhaoId].filter(Boolean).length

  return (
    <div className="entregas__painel">
      <SeletorPeriodo modo={modo} setModo={setModo} referencia={referencia} setReferencia={setReferencia} rotulo={periodo.rotulo} />

      <div className="entregas__indicadores">
        <div className="indicador">
          <span className="indicador__titulo">Entregas no período</span>
          <span className="indicador__valor">{doPeriodo.length}</span>
          <span className="indicador__aux">{pluralizar(doPeriodo.length, 'pedido concluído', 'pedidos concluídos')}</span>
        </div>
        <div className="indicador">
          <span className="indicador__titulo">Metragem total</span>
          <span className="indicador__valor">{formatarMetragem(totais.metragem)}</span>
          <span className="indicador__aux">no período selecionado</span>
        </div>
        <div className="indicador">
          <span className="indicador__titulo">Valor total</span>
          <span className="indicador__valor">{formatarMoedaNumero(totais.valor)}</span>
          <span className="indicador__aux">faturamento entregue no período</span>
        </div>
        <div className="indicador">
          <span className="indicador__titulo">Motoristas ativos</span>
          <span className="indicador__valor">{ativos.length}</span>
          <span className="indicador__aux">
            {ativos.length === 0 ? 'nenhum motorista ativo' : ativos.length === 1 ? ativos[0].nome : 'cadastrados'}
          </span>
        </div>
      </div>

      {sucesso && <p className="aviso aviso--ok">{sucesso}</p>}

      <div className="entregas__lista-cabecalho">
        <div>
          <h2 className="entregas__lista-titulo">Entregas do período</h2>
          <p className="entregas__lista-contagem">{textoRegistros(filtradas.length)}</p>
        </div>
        <div className="entregas__lista-acoes">
          <div className="entregas__busca-wrap">
            <svg className="entregas__busca-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              className="entregas__busca"
              placeholder="Buscar cliente ou pedido"
              aria-label="Buscar por cliente ou pedido"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <div className="entregas__filtros-wrap">
            <button
              ref={filtrosBotaoRef}
              type="button"
              className={`botao botao--neutro botao--pequeno ${filtrosAtivos ? 'botao--ativo' : ''}`}
              aria-expanded={filtrosAbertos}
              aria-haspopup="dialog"
              onClick={() => setFiltrosAbertos((a) => !a)}
            >
              Filtros{quantidadeFiltrosAtivos > 0 ? ` (${quantidadeFiltrosAtivos})` : ''}
            </button>
            {filtrosAbertos && (
              <div ref={filtrosPainelRef} className="entregas__filtros-painel" role="dialog" aria-label="Filtros da listagem">
                <label className="entregas__filtros-campo">
                  Motorista
                  <select
                    className="seletor"
                    value={filtroMotoristaId}
                    onChange={(e) => setFiltroMotoristaId(e.target.value)}
                  >
                    <option value="">Todos</option>
                    {motoristas.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="entregas__filtros-campo">
                  Caminhão
                  <select
                    className="seletor"
                    value={filtroCaminhaoId}
                    onChange={(e) => setFiltroCaminhaoId(e.target.value)}
                  >
                    <option value="">Todos</option>
                    {caminhoes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.placa}
                        {c.modelo ? ` · ${c.modelo}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {filtrosAtivos && (
                  <button
                    type="button"
                    className="botao botao--neutro botao--pequeno"
                    onClick={() => {
                      setFiltroMotoristaId('')
                      setFiltroCaminhaoId('')
                    }}
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            )}
          </div>

          <button type="button" className="botao botao--neutro botao--pequeno" onClick={exportarCsv} disabled={filtradas.length === 0}>
            Exportar CSV
          </button>
        </div>
      </div>

      {filtradas.length === 0 ? (
        <p className="entregas__vazio">Nenhuma entrega encontrada para os filtros selecionados.</p>
      ) : (
        <>
          <div className="entregas__tabela-wrap">
            <table className="entregas__tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Motorista</th>
                  <th>Caminhão</th>
                  <th>Pedido</th>
                  <th className="entregas__col-cliente">Cliente</th>
                  <th className="entregas__col-numerica">Metragem</th>
                  <th className="entregas__col-numerica">Valor</th>
                  <th>Status</th>
                  <th className="entregas__col-acoes">
                    <span className="visualmente-oculto">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginaAtual.map((e) => (
                  <tr key={e.id}>
                    <td data-rotulo="Data">{formatarDataBr(e.data)}</td>
                    <td data-rotulo="Motorista">{nomeMotorista.get(e.motoristaId) ?? '—'}</td>
                    <td data-rotulo="Caminhão">{placaCaminhao.get(e.caminhaoId) ?? '—'}</td>
                    <td data-rotulo="Pedido">{e.pedido}</td>
                    <td data-rotulo="Cliente" className="entregas__col-cliente entregas__celula-truncada" title={e.cliente ?? '—'}>
                      {e.cliente ?? '—'}
                    </td>
                    <td data-rotulo="Metragem" className="entregas__col-numerica">
                      {e.metragem != null ? formatarMetragem(e.metragem) : '—'}
                    </td>
                    <td data-rotulo="Valor" className="entregas__col-numerica">
                      {e.valor != null ? formatarMoedaNumero(e.valor) : '—'}
                    </td>
                    <td data-rotulo="Status">
                      <span className="status-badge status-badge--entregue">Entregue</span>
                    </td>
                    <td data-rotulo="Ações" className="entregas__col-acoes">
                      <MenuAcoes
                        rotulo={`a entrega do pedido ${e.pedido}`}
                        itens={[{ texto: 'Excluir entrega', perigo: true, aoClicar: () => setEntregaParaExcluir(e) }]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="entregas__rodape">
            <span className="entregas__rodape-total">
              Mostrando {paginaAtual.length} de {filtradas.length} {pluralizar(filtradas.length, 'entrega', 'entregas')}
            </span>
            {totalPaginas > 1 && (
              <div className="entregas__paginacao">
                <button
                  type="button"
                  className="botao botao--neutro botao--pequeno"
                  disabled={pagina <= 1}
                  onClick={() => setPagina((p) => p - 1)}
                >
                  Anterior
                </button>
                <span className="entregas__paginacao-atual">
                  Página {pagina} de {totalPaginas}
                </span>
                <button
                  type="button"
                  className="botao botao--neutro botao--pequeno"
                  disabled={pagina >= totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Próxima
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {entregaParaExcluir && (
        <ModalConfirmar
          titulo="Excluir entrega?"
          mensagem={`Esta ação não poderá ser desfeita. Deseja excluir a entrega do pedido ${entregaParaExcluir.pedido}?`}
          textoConfirmar="Excluir entrega"
          textoConfirmando="Excluindo..."
          confirmando={excluindo}
          onConfirmar={confirmarExclusao}
          onCancelar={() => setEntregaParaExcluir(null)}
        />
      )}
    </div>
  )
}

function Ranking({ entregas, motoristas }) {
  // Ranking olha o quadro geral por padrao — "mes" faz mais sentido aqui do que "dia" (que e
  // o padrao do Relatorio, focado no dia a dia de lancamentos).
  const [modo, setModo] = useState('mes')
  const [referencia, setReferencia] = useState(() => new Date())
  const [busca, setBusca] = useState('')
  const [somenteAtivos, setSomenteAtivos] = useState(false)

  const periodo = useMemo(() => intervaloDoPeriodo(modo, referencia), [modo, referencia])
  const doPeriodo = useMemo(() => filtrarPorPeriodo(entregas, periodo), [entregas, periodo])
  const ranking = useMemo(() => rankingPorMotorista(doPeriodo, motoristas), [doPeriodo, motoristas])

  const filtrado = useMemo(() => {
    const alvo = busca.trim().toLowerCase()
    return ranking.filter((r) => (!somenteAtivos || r.ativo) && (!alvo || r.nome.toLowerCase().includes(alvo)))
  }, [ranking, busca, somenteAtivos])

  return (
    <div className="entregas__painel">
      <SeletorPeriodo modo={modo} setModo={setModo} referencia={referencia} setReferencia={setReferencia} rotulo={periodo.rotulo} />

      <div className="entregas__lista-cabecalho">
        <div>
          <h2 className="entregas__lista-titulo">Ranking de motoristas</h2>
          <p className="entregas__lista-contagem">{textoRegistros(filtrado.length)}</p>
        </div>
        <div className="entregas__lista-acoes">
          <div className="entregas__busca-wrap">
            <svg className="entregas__busca-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              className="entregas__busca"
              placeholder="Buscar motorista"
              aria-label="Buscar motorista"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <label className="entregas__filtro-toggle">
            <input type="checkbox" checked={somenteAtivos} onChange={(e) => setSomenteAtivos(e.target.checked)} />
            Somente ativos
          </label>
        </div>
      </div>

      {filtrado.length === 0 ? (
        <p className="entregas__vazio">Nenhum motorista com entregas nesse período.</p>
      ) : (
        <div className="entregas__tabela-wrap">
          <table className="entregas__tabela">
            <thead>
              <tr>
                <th className="entregas__col-numerica">#</th>
                <th>Motorista</th>
                <th className="entregas__col-numerica">Pedidos entregues</th>
                <th className="entregas__col-numerica">Metragem total</th>
                <th className="entregas__col-numerica">Valor total</th>
              </tr>
            </thead>
            <tbody>
              {filtrado.map((r, i) => (
                <tr key={r.motoristaId}>
                  <td data-rotulo="Posição" className="entregas__col-numerica">
                    <span
                      className={`entregas__ranking-posicao ${i < 3 ? `entregas__ranking-posicao--${i + 1}` : ''}`}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td data-rotulo="Motorista">
                    {r.nome}
                    {!r.ativo && <span className="entregas__ranking-inativo"> (inativo)</span>}
                  </td>
                  <td data-rotulo="Pedidos entregues" className="entregas__col-numerica">
                    {r.pedidos}
                  </td>
                  <td data-rotulo="Metragem total" className="entregas__col-numerica">
                    {formatarMetragem(r.metragem)}
                  </td>
                  <td data-rotulo="Valor total" className="entregas__col-numerica">
                    {formatarMoedaNumero(r.valor)}
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
