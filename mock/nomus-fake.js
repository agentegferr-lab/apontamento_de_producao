/**
 * Nomus falso para desenvolvimento e treinamento — NAO faz parte do app.
 * Serve pra testar o terminal sem bater no ERP de producao (e sem gerar apontamento real).
 *
 *   node mock/nomus-fake.js
 *   NOMUS_BASE_URL=http://localhost:4000/rest npm start
 *
 * Simula throttling 429 (com tempoAteLiberar) via MOCK_THROTTLE=0.3 (30% das chamadas).
 *
 * Simula tambem a paginacao silenciosa confirmada no Nomus real: toda lista responde
 * `?pagina=N` (1-indexado), 50 registros por pagina. Como este mock tem poucos registros,
 * tudo cabe na pagina 1 — a pagina 2+ sempre vem vazia, exercitando o mesmo "para quando a
 * pagina vem curta" que o codigo real usa, so que sem precisar de milhares de linhas aqui.
 */
import express from 'express'

const app = express()
app.use(express.json())

const PORTA = Number(process.env.MOCK_PORT ?? 4000)
const CHANCE_429 = Number(process.env.MOCK_THROTTLE ?? 0)

const funcionarios = [
  { id: 5, nome: 'Joao da Silva', matricula: '1234', ativo: true, limiteApontamentosSimultaneos: 3 },
]

const recursos = [
  // Corte tem DUAS maquinas de proposito: e o caso em que o app precisa perguntar qual delas.
  { id: 1, nome: 'Serra Fita 01', ativo: true, centroTrabalho: { id: 10, nome: 'Corte' } },
  { id: 5, nome: 'Serra Fita 02', ativo: true, centroTrabalho: { id: 10, nome: 'Corte' } },
  { id: 2, nome: 'Cabine de Pintura 02', ativo: true, centroTrabalho: { id: 20, nome: 'Pintura' } },
  { id: 3, nome: 'Bancada de Colagem 01', ativo: true, centroTrabalho: { id: 30, nome: 'Colagem' } },
  { id: 6, nome: 'Expedicao 01', ativo: true, centroTrabalho: { id: 40, nome: 'Expedicao' } },
  { id: 7, nome: 'Logistica 01', ativo: true, centroTrabalho: { id: 50, nome: 'Logistica' } },
  { id: 4, nome: 'Recurso Desativado', ativo: false, centroTrabalho: { id: 90, nome: 'Antigo' } },
]

const producao = { id: 100, nome: 'Producao', ativo: true, aptOrdemOperacao: true, aptFuncionario: true, aptQtdProduzida: true, aptPercentualProdAndamento: false, tratamentoQtde: 'OBRIGATORIA' }
const setup = { id: 101, nome: 'Setup de maquina', ativo: true, aptOrdemOperacao: true, aptFuncionario: true, aptQtdProduzida: false, aptPercentualProdAndamento: false, tratamentoQtde: 'NAO_INFORMA' }
const retrabalho = { id: 102, nome: 'Retrabalho', ativo: true, aptOrdemOperacao: true, aptFuncionario: true, aptQtdProduzida: true, aptPercentualProdAndamento: true, tratamentoQtde: 'OBRIGATORIA' }

// Paradas sao atividades como qualquer outra no Nomus — nao ha flag que as distinga.
const parada = (id, nome) => ({
  id,
  nome,
  ativo: true,
  aptOrdemOperacao: true,
  aptFuncionario: true,
  aptQtdProduzida: false,
  aptPercentualProdAndamento: false,
  tratamentoQtde: 'NAO_INFORMA',
})

const PARADAS = (base) => [
  parada(base + 1, 'Parada tecnica'),
  parada(base + 2, 'Parada para refeicao'),
  parada(base + 3, 'Banheiro'),
  parada(base + 4, 'Quebra de maquina'),
  parada(base + 5, 'Falta de material'),
]

const atividades = {
  1: [producao, setup, retrabalho, ...PARADAS(110)],
  5: [{ ...producao, id: 500 }, { ...setup, id: 501 }, ...PARADAS(510)],
  2: [{ ...producao, id: 200 }, ...PARADAS(210)],
  3: [{ ...producao, id: 300 }, ...PARADAS(310)],
  6: [{ ...producao, id: 600 }, ...PARADAS(610)],
  7: [{ ...producao, id: 700 }, ...PARADAS(710)],
}

// Roteiro: Corte (10) -> Pintura (20) -> Colagem (30) -> Expedicao (40) -> Logistica (50).
const ROTEIRO = [
  ['10', 'Corte', 'Corte'],
  ['20', 'Pintura', 'Pintura'],
  ['30', 'Colagem', 'Colagem'],
  ['40', 'Expedicao', 'Expedicao'],
  ['50', 'Logistica', 'Logistica'],
]

// [ordem, produto, pedido, cliente]
const PRODUTOS = [
  ['12345', 'Telha Trapezoidal 0,50mm', 'PV-2026-0431', 'Construtora ABC'],
  ['12346', 'Telha Ondulada 0,43mm', 'PV-2026-0432', 'Metalurgica Silva'],
  ['99887', 'Telha Sanduiche 30mm', 'PV-2026-0433', 'Frigorifico Sul'],
  ['12350', 'Rufo Externo 0,50mm', 'PV-2026-0440', 'Joao Materiais'],
  ['12351', 'Calha Moldura 0,43mm', 'PV-2026-0441', 'Construtora XYZ'],
]

/**
 * /ordens e /pedidos: formato confirmado contra o Nomus real (Grupo Ferro) em 2026-07-15.
 * O pedido NAO fica direto na ordem — o vinculo e ordens[].itensPedido[0].idPedido ==
 * pedidos[].id, e o codigo mostrado ao operador e pedidos[].codigoPedido. Reproduzido aqui
 * pra o mock exercitar o mesmo caminho de codigo que o Nomus real, nao um atalho mais simples.
 */
const ordens = PRODUTOS.map(([nomeOrdem, produto, pedido, cliente], i) => ({
  id: 501 + i,
  nome: nomeOrdem,
  descricaoProduto: produto,
  itensPedido: [{ id: 2700 + i, idPedido: 1200 + i, item: '00010', nomeCliente: cliente }],
}))

const pedidos = PRODUTOS.map((_, i) => ({
  id: 1200 + i,
  codigoPedido: `PD ${String(1290 + i).padStart(5, '0')}`,
}))

const operacoes = []
PRODUTOS.forEach(([nomeOrdem, produto], i) => {
  const idOrdem = 501 + i
  ROTEIRO.forEach(([operacao, etapa, centro], j) => {
    operacoes.push({
      id: 9000 + i * 10 + j,
      idOrdem,
      nomeOrdem,
      operacao,
      descricao: `${etapa} — ${produto}`,
      centroTrabalhoPlanejado: centro,
    })
  })
})

const apontamentos = []

app.use((req, res, next) => {
  if (!req.headers.authorization?.startsWith('Basic ')) {
    return res.status(401).json({ mensagem: 'Chave de integracao ausente.' })
  }
  if (CHANCE_429 > 0 && Math.random() < CHANCE_429) {
    console.log(`[mock] 429 em ${req.method} ${req.path}`)
    return res.status(429).json({ mensagem: 'Limite de requisicoes atingido.', tempoAteLiberar: 2 })
  }
  console.log(`[mock] ${req.method} ${req.originalUrl}`)
  next()
})

/** Pagina uma lista como o Nomus real faz: 50 por pagina, silencioso, 1-indexado. */
function paginar(lista, req, res) {
  const TAMANHO = 50
  const pagina = Math.max(1, Number(req.query.pagina) || 1)
  const inicio = (pagina - 1) * TAMANHO
  res.json(lista.slice(inicio, inicio + TAMANHO))
}

app.get('/rest/funcionarios', (req, res) => {
  const { matricula } = req.query
  const lista = matricula ? funcionarios.filter((f) => String(f.matricula) === String(matricula)) : funcionarios
  paginar(lista, req, res)
})

app.get('/rest/recursos', (req, res) => paginar(recursos, req, res))

app.get('/rest/ordens', (req, res) => paginar(ordens, req, res))

// /pedidos so por id, de proposito: o Nomus real tem milhares e nao deve ser listado
// inteiro (ver server/pedidos.js). Sem :id aqui de proposito, pra qualquer chamada que
// tente listar tudo falhar alto e cedo, em vez de silenciosamente devolver so a 1a pagina.
app.get('/rest/pedidos/:id', (req, res) => {
  const pedido = pedidos.find((p) => String(p.id) === req.params.id)
  if (!pedido) return res.status(404).json({ mensagem: `Pedido ${req.params.id} nao encontrado.` })
  res.json(pedido)
})

app.get('/rest/atividades', (req, res) => paginar(atividades[Number(req.query.idRecurso)] ?? [], req, res))

app.get('/rest/operacoesRoteiroOrdem', (req, res) => {
  // Espelha o comportamento confirmado do Nomus real: ?nomeOrdem e ?idOrdem sao ignorados,
  // sempre devolve a base inteira (paginada) — o resolver busca por id direto, nao filtra.
  paginar(operacoes, req, res)
})

app.post('/rest/apontamentos', (req, res) => {
  const registro = { id: 7000 + apontamentos.length, ...req.body }
  apontamentos.push(registro)
  console.log('[mock] apontamento gravado:', JSON.stringify(registro))
  res.status(201).json(registro)
})

app.get('/rest/apontamentos', (req, res) => paginar(apontamentos, req, res))

app.listen(PORTA, () => {
  console.log(`Nomus FALSO em http://localhost:${PORTA}/rest`)
  console.log(`Matricula de teste: 1234`)
  console.log('')
  console.log('Codigos de barras de teste (codigo da ORDEM = idOrdem, codigo do PROCESSO = id):')
  operacoes
    .filter((o) => o.operacao === '10')
    .forEach((o) => console.log(`  OS ${o.nomeOrdem}: ordem=${o.idOrdem} processo=${o.id} (${o.descricao})`))
})
