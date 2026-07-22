import test from 'node:test'
import assert from 'node:assert/strict'
import { montarKanban, ordenarColunas, nomeCentro, STATUS, parseDataNomus } from './kanban.js'

test('parseDataNomus le DD/MM/YYYY sem inverter dia e mes (Date.parse faria isso errado)', () => {
  // 03/07/2026 e 3 de julho. Date.parse, dependendo do motor, poderia ler como 7 de marco
  // (formato americano MM/DD) — e exatamente o bug que motivou nao usar Date.parse aqui.
  const data = parseDataNomus('03/07/2026 14:22:17')
  assert.equal(data.getDate(), 3)
  assert.equal(data.getMonth(), 6) // julho = indice 6
  assert.equal(data.getFullYear(), 2026)
  assert.equal(data.getHours(), 14)
})

test('parseDataNomus devolve null pra lixo, sem lancar excecao', () => {
  assert.equal(parseDataNomus('lixo'), null)
  assert.equal(parseDataNomus(''), null)
  assert.equal(parseDataNomus(null), null)
  assert.equal(parseDataNomus(undefined), null)
})

const roteiro = [
  { id: 1, idOrdem: 500, nomeOrdem: 'OS-1', operacao: '10', descricao: 'Corte', centroTrabalhoPlanejado: 'Corte' },
  { id: 2, idOrdem: 500, nomeOrdem: 'OS-1', operacao: '20', descricao: 'Pintura', centroTrabalhoPlanejado: 'Pintura' },
  { id: 3, idOrdem: 500, nomeOrdem: 'OS-1', operacao: '30', descricao: 'Colagem', centroTrabalhoPlanejado: 'Colagem' },
]

const coluna = (kanban, nome) => kanban.colunas.find((c) => c.nome === nome)
const cardDe = (kanban, nome) => coluna(kanban, nome)?.cards[0]

test('nomeCentro aceita texto ou objeto {id, nome}', () => {
  assert.equal(nomeCentro('Corte'), 'Corte')
  assert.equal(nomeCentro({ id: 1, nome: 'Pintura' }), 'Pintura')
  assert.equal(nomeCentro(null), null)
  assert.equal(nomeCentro(''), null)
})

test('as colunas seguem a ordem do roteiro, nao a alfabetica', () => {
  assert.deepEqual(ordenarColunas(roteiro), ['Corte', 'Pintura', 'Colagem'])
})

test('EXPEDIÇÃO e LOGÍSTICA vao sempre por ultimo, mesmo com numero de operacao baixo', () => {
  // Roteiro real: um produto so faz Corte + Expedicao (sem pintura/colagem), dando a
  // Expedicao a operacao 20 — mais baixa que a Colagem (30) de outros produtos. Mesmo
  // assim, Expedicao/Logistica tem que ficar depois de Colagem no quadro.
  const operacoesComExpedicao = [
    { id: 1, idOrdem: 500, operacao: '10', centroTrabalhoPlanejado: 'CORTE' },
    { id: 2, idOrdem: 500, operacao: '20', centroTrabalhoPlanejado: 'EXPEDIÇÃO' },
    { id: 3, idOrdem: 501, operacao: '10', centroTrabalhoPlanejado: 'CORTE' },
    { id: 4, idOrdem: 501, operacao: '20', centroTrabalhoPlanejado: 'PINTURA' },
    { id: 5, idOrdem: 501, operacao: '30', centroTrabalhoPlanejado: 'COLAGEM' },
    { id: 6, idOrdem: 501, operacao: '40', centroTrabalhoPlanejado: 'LOGÍSTICA' },
  ]
  assert.deepEqual(ordenarColunas(operacoesComExpedicao), ['CORTE', 'PINTURA', 'COLAGEM', 'EXPEDIÇÃO', 'LOGÍSTICA'])
})

test('ordem que nunca iniciou nenhum processo vai pra fila invisivel, nao pro quadro', () => {
  const k = montarKanban({ operacoes: roteiro, apontamentos: [], emAndamento: [] })
  // As colunas continuam existindo (roteiro pequeno = todas ficam visiveis mesmo vazias),
  // mas nenhuma tem card nenhum — a ordem inteira foi pra fila, nao pro quadro.
  assert.equal(k.colunas.every((c) => c.cards.length === 0), true)

  assert.equal(k.filaAguardando.length, 1)
  const card = k.filaAguardando[0]
  assert.equal(card.status, STATUS.AGUARDANDO)
  assert.equal(card.etapasConcluidas, 0)
  assert.equal(card.coluna, 'Corte') // o dado continua sabendo onde ela comecaria
})

test('ordem que ja concluiu uma etapa mas espera a proxima continua VISIVEL (nao e fila)', () => {
  // Corte concluido, Pintura ainda nao comecou: isto e producao em andamento de verdade
  // (etapasConcluidas > 0), so que a etapa atual esta parada esperando a vez — bem
  // diferente de uma ordem que nunca foi tocada. Tem que continuar visivel no quadro.
  const k = montarKanban({
    operacoes: roteiro,
    apontamentos: [{ idOperacaoOrdem: 1, dataHoraInicial: '15/07/2026 08:00:00', dataHoraFinal: '15/07/2026 09:00:00' }],
    emAndamento: [],
  })
  assert.equal(k.filaAguardando.length, 0)
  const card = cardDe(k, 'Pintura')
  assert.equal(card.status, STATUS.AGUARDANDO)
  assert.equal(card.etapasConcluidas, 1)
})

test('apontamento aberto no corte deixa a ordem EM PRODUCAO no corte', () => {
  const k = montarKanban({
    operacoes: roteiro,
    apontamentos: [],
    emAndamento: [{ idOperacaoOrdem: 1, dataHoraInicial: '2026-07-15T08:00:00', nomeFuncionario: 'Joao' }],
  })
  const card = cardDe(k, 'Corte')
  assert.equal(card.status, STATUS.EM_PRODUCAO)
  assert.equal(card.dataHoraInicial, '2026-07-15T08:00:00')
  assert.equal(card.operadorAtual, 'Joao')
})

test('ao finalizar o corte, a ordem anda sozinha para a pintura', () => {
  // Datas em formato BR (DD/MM/YYYY): e o que GET /apontamentos do Nomus real devolve,
  // confirmado com um POST de teste real (ver server/index.js, paraFormatoNomus).
  const k = montarKanban({
    operacoes: roteiro,
    apontamentos: [{ idOperacaoOrdem: 1, dataHoraInicial: '15/07/2026 08:00:00', dataHoraFinal: '15/07/2026 09:00:00' }],
    emAndamento: [],
  })
  assert.equal(coluna(k, 'Corte').cards.length, 0, 'nao pode sobrar card no corte')
  const card = cardDe(k, 'Pintura')
  assert.equal(card.status, STATUS.AGUARDANDO)
  assert.equal(card.etapasConcluidas, 1)
  assert.equal(card.tempoGravadoMs, 3600_000)
})

test('roteiro inteiro apontado vira CONCLUIDO e sai do quadro visivel', () => {
  // Ordem concluida nao deve mais aparecer nas colunas — vai pro bucket k.concluidos,
  // mesmo padrao invisivel-mas-presente-na-API do filaAguardando (ver pedido do usuario:
  // "quero que apague os cards mockados e os cards que ja foram concluidos").
  const apontamentos = [1, 2, 3].map((id) => ({
    idOperacaoOrdem: id,
    dataHoraInicial: '15/07/2026 08:00:00',
    dataHoraFinal: '15/07/2026 08:30:00',
  }))
  const k = montarKanban({ operacoes: roteiro, apontamentos, emAndamento: [] })
  assert.equal(coluna(k, 'Colagem').cards.length, 0, 'card concluido nao pode aparecer no quadro')

  assert.equal(k.concluidos.length, 1)
  const card = k.concluidos[0]
  assert.equal(card.status, STATUS.CONCLUIDO)
  assert.equal(card.etapasConcluidas, 3)
  assert.equal(card.totalEtapas, 3)
  assert.equal(card.tempoGravadoMs, 90 * 60_000)
})

test('processo pausado aparece como PARADO com o motivo, e nao como EM PRODUCAO', () => {
  const k = montarKanban({
    operacoes: roteiro,
    apontamentos: [],
    emAndamento: [
      {
        idOperacaoOrdem: 1,
        dataHoraInicial: '2026-07-15T12:00:00',
        nomeFuncionario: 'Joao',
        estado: 'PAUSADO',
        paradaAtual: { idAtividade: 9, nomeAtividade: 'Parada para refeicao' },
      },
    ],
  })
  const card = cardDe(k, 'Corte')
  assert.equal(card.status, STATUS.PARADO)
  assert.equal(card.motivoParada, 'Parada para refeicao')
})

test('pausar nao pode concluir a etapa: o card fica onde estava', () => {
  // O kanban trata "etapa tem apontamento" como concluida. Como a pausa nao grava nada no
  // Nomus, a ordem nao pode escorregar pra proxima coluna no meio do almoco.
  const k = montarKanban({
    operacoes: roteiro,
    apontamentos: [],
    emAndamento: [
      {
        idOperacaoOrdem: 1,
        dataHoraInicial: '2026-07-15T12:00:00',
        estado: 'PAUSADO',
        paradaAtual: { idAtividade: 9, nomeAtividade: 'Refeicao' },
      },
    ],
  })
  assert.equal(coluna(k, 'Corte').cards.length, 1)
  assert.equal(coluna(k, 'Pintura').cards.length, 0)
})

test('trabalho em andamento nunca fica invisivel: a etapa aberta ganha da primeira pendente', () => {
  // Comecaram a pintura sem o corte ter sido apontado. A regra crua ("primeira pendente")
  // mostraria a ordem parada no corte como AGUARDANDO, escondendo quem esta produzindo.
  const k = montarKanban({
    operacoes: roteiro,
    apontamentos: [],
    emAndamento: [{ idOperacaoOrdem: 2, dataHoraInicial: '2026-07-15T08:00:00', nomeFuncionario: 'Ana' }],
  })
  assert.equal(coluna(k, 'Corte').cards.length, 0)
  const card = cardDe(k, 'Pintura')
  assert.equal(card.status, STATUS.EM_PRODUCAO)
  assert.equal(card.operadorAtual, 'Ana')
})

test('etapa pulada e ja finalizada nao arrasta a ordem: fica na primeira pendente', () => {
  // Apontaram a pintura sem apontar o corte. O card tem que continuar no corte.
  const k = montarKanban({
    operacoes: roteiro,
    apontamentos: [{ idOperacaoOrdem: 2, dataHoraInicial: '15/07/2026 08:00:00', dataHoraFinal: '15/07/2026 08:10:00' }],
    emAndamento: [],
  })
  assert.equal(cardDe(k, 'Corte').status, STATUS.AGUARDANDO)
  assert.equal(coluna(k, 'Pintura').cards.length, 0)
})

test('apontamento de operacao desconhecida nao quebra nem soma tempo', () => {
  // Nenhum apontamento casa com uma operacao do roteiro: a ordem continua "nunca tocada"
  // de verdade, entao vai pra fila invisivel — e e la que se confere o tempo.
  const k = montarKanban({
    operacoes: roteiro,
    apontamentos: [{ idOperacaoOrdem: 9999, dataHoraInicial: 'lixo', dataHoraFinal: 'lixo' }],
    emAndamento: [],
  })
  assert.equal(k.filaAguardando[0].tempoGravadoMs, 0)
})

test('pedido oculto some do quadro inteiro (cards, fila e concluidos), nao so vira CONCLUIDO', () => {
  const pedidosPorOrdem = new Map([[500, { pedido: 'PD 01038' }]])

  const semOcultar = montarKanban({ operacoes: roteiro, apontamentos: [], emAndamento: [], pedidosPorOrdem })
  assert.equal(semOcultar.filaAguardando.length, 1, 'sanity check: sem ocultar, a ordem aparece na fila')

  const comOcultar = montarKanban({
    operacoes: roteiro,
    apontamentos: [],
    emAndamento: [],
    pedidosPorOrdem,
    pedidosOcultos: new Set(['1038']),
  })
  assert.equal(comOcultar.filaAguardando.length, 0)
  assert.equal(comOcultar.colunas.every((c) => c.cards.length === 0), true)
})

test('ordens diferentes aparecem em colunas diferentes conforme seu proprio avanco', () => {
  const operacoes = [
    ...roteiro,
    { id: 11, idOrdem: 501, nomeOrdem: 'OS-2', operacao: '10', descricao: 'Corte', centroTrabalhoPlanejado: 'Corte' },
    { id: 12, idOrdem: 501, nomeOrdem: 'OS-2', operacao: '20', descricao: 'Pintura', centroTrabalhoPlanejado: 'Pintura' },
  ]
  const k = montarKanban({
    operacoes,
    apontamentos: [{ idOperacaoOrdem: 11, dataHoraInicial: '15/07/2026 08:00:00', dataHoraFinal: '15/07/2026 08:05:00' }],
    // OS-1 esta com o Corte em andamento (visivel); OS-2 ja concluiu o Corte e espera a
    // Pintura (tambem visivel, por ter etapasConcluidas > 0). Nenhuma das duas e "nunca
    // tocada", entao nenhuma cai na fila invisivel — o que este teste quer conferir e a
    // coluna, nao a fila (ver teste dedicado da fila acima).
    emAndamento: [{ idOperacaoOrdem: 1, dataHoraInicial: '2026-07-15T08:00:00', nomeFuncionario: 'Joao' }],
  })
  assert.equal(k.filaAguardando.length, 0)
  assert.equal(cardDe(k, 'Corte').nomeOrdem, 'OS-1')
  assert.equal(cardDe(k, 'Pintura').nomeOrdem, 'OS-2')
})
