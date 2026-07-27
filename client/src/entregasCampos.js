/**
 * Funcoes puras da tela de Entregas (client/src/components/TelaEntregas.jsx) — calculo de
 * periodo (dia/semana/mes) e agregacao do relatorio. Separadas do componente pra testar sem
 * precisar montar React (mesmo padrao de planejamentoCampos.js/kanbanCampos.js).
 */

function chaveData(data) {
  const p = (n) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`
}

/** Domingo da semana que contem `data` (0 = domingo, mesma convencao do calendario do Planejamento). */
function inicioDaSemana(data) {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate())
  d.setDate(d.getDate() - d.getDay())
  return d
}

const NOME_MES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/**
 * Devolve { inicio, fim } (chaves "AAAA-MM-DD", inclusive dos dois lados) e um `rotulo` pra
 * exibir, pro modo e data de referencia dados. "Semana" e domingo a sabado da semana que
 * contem a referencia; "mes" e o mes calendario inteiro.
 */
export function intervaloDoPeriodo(modo, referencia) {
  if (modo === 'dia') {
    const chave = chaveData(referencia)
    return { inicio: chave, fim: chave, rotulo: referencia.toLocaleDateString('pt-BR', { dateStyle: 'long' }) }
  }
  if (modo === 'semana') {
    const inicio = inicioDaSemana(referencia)
    const fim = new Date(inicio)
    fim.setDate(fim.getDate() + 6)
    return {
      inicio: chaveData(inicio),
      fim: chaveData(fim),
      rotulo: `${inicio.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')}`,
    }
  }
  const inicio = new Date(referencia.getFullYear(), referencia.getMonth(), 1)
  const fim = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0)
  return { inicio: chaveData(inicio), fim: chaveData(fim), rotulo: `${NOME_MES[referencia.getMonth()]} de ${referencia.getFullYear()}` }
}

/** Move a data de referencia pra frente/tras conforme o modo (1 dia, 1 semana ou 1 mes por vez). */
export function navegarPeriodo(modo, referencia, delta) {
  const d = new Date(referencia)
  if (modo === 'dia') d.setDate(d.getDate() + delta)
  else if (modo === 'semana') d.setDate(d.getDate() + delta * 7)
  else d.setMonth(d.getMonth() + delta)
  return d
}

/** `entregas` com `data` dentro de [inicio, fim] (comparacao de string, chaves "AAAA-MM-DD"). */
export function filtrarPorPeriodo(entregas, { inicio, fim }) {
  return entregas.filter((e) => e.data >= inicio && e.data <= fim)
}

/** Quantos pedidos cada motorista entregou no periodo, do que mais entregou pro que menos. */
export function agruparPorMotorista(entregasFiltradas, motoristas) {
  const nomePorId = new Map(motoristas.map((m) => [m.id, m.nome]))
  const contagem = new Map()
  for (const e of entregasFiltradas) {
    contagem.set(e.motoristaId, (contagem.get(e.motoristaId) ?? 0) + 1)
  }
  return [...contagem.entries()]
    .map(([motoristaId, total]) => ({ motoristaId, nome: nomePorId.get(motoristaId) ?? 'Motorista removido', total }))
    .sort((a, b) => b.total - a.total)
}

/** Soma metragem/valor do periodo — `metragem`/`valor` sao opcionais (null quando o
 * motorista nao informou), entao null/undefined simplesmente nao entram na soma. */
export function somarTotais(entregasFiltradas) {
  let metragem = 0
  let valor = 0
  for (const e of entregasFiltradas) {
    if (e.metragem != null) metragem += e.metragem
    if (e.valor != null) valor += e.valor
  }
  return { metragem, valor }
}
