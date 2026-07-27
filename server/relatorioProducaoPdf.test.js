import test from 'node:test'
import assert from 'node:assert/strict'
import PDFDocument from 'pdfkit'
import { gerarPdfRelatorioProducao } from './relatorioProducaoPdf.js'

/** Gera o PDF em memoria (sem tocar disco) e devolve o buffer final, pra inspecionar bytes. */
function gerarBuffer(dados) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true })
    const pedacos = []
    doc.on('data', (p) => pedacos.push(p))
    doc.on('end', () => resolve(Buffer.concat(pedacos)))
    doc.on('error', reject)
    gerarPdfRelatorioProducao(doc, dados)
    doc.end()
  })
}

const PORCENTRO = [
  { centro: 'CORTE', apontamentos: 3, ordens: 2, tempoMs: 5_400_000, quantidades: [{ unidade: 'METRO QUADRADO', total: 290 }] },
  { centro: 'PINTURA', apontamentos: 1, ordens: 1, tempoMs: 3_600_000, quantidades: [{ unidade: 'METRO QUADRADO', total: 210 }] },
]

const DETALHADO = [
  {
    id: 1,
    centro: 'CORTE',
    nomeOrdem: 'OS 01632 - 001',
    descricaoEtapa: 'Corte da telha',
    quantidade: 210,
    unidadeMedida: 'METRO QUADRADO',
    funcionario: 'DIOGO RODRIGO ESPINDOLA FRANCO',
    dataHoraFinal: '27/07/2026 17:53:07',
    duracaoMs: 919_000,
  },
]

test('gera um PDF valido (comeca com a assinatura %PDF) sem lancar excecao', async () => {
  const buffer = await gerarBuffer({
    periodoRotulo: '27 de julho de 2026',
    porCentro: PORCENTRO,
    detalhado: DETALHADO,
    geradoEm: '27/07/2026 20:00:00',
  })
  assert.ok(buffer.length > 0)
  assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-')
})

test('funciona com listas vazias (periodo sem nenhum apontamento), sem lancar excecao', async () => {
  const buffer = await gerarBuffer({
    periodoRotulo: '1 de janeiro de 2026',
    porCentro: [],
    detalhado: [],
    geradoEm: '27/07/2026 20:00:00',
  })
  assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-')
})

test('paginacao: MUITAS linhas detalhadas geram mais de uma pagina', async () => {
  const muitasLinhas = Array.from({ length: 120 }, (_, i) => ({
    ...DETALHADO[0],
    id: i,
    nomeOrdem: `OS ${String(i).padStart(5, '0')} - 001`,
  }))
  const buffer = await gerarBuffer({
    periodoRotulo: 'julho de 2026',
    porCentro: PORCENTRO,
    detalhado: muitasLinhas,
    geradoEm: '27/07/2026 20:00:00',
  })
  // Cada pagina do PDF tem seu proprio objeto "/Type /Page" (o pai "/Pages" nao conta,
  // por isso o lookahead negativo pro "s").
  const paginas = buffer.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []
  assert.ok(paginas.length > 1, `esperava mais de 1 pagina, veio ${paginas.length}`)
})

test('nomes de colaborador/etapa muito longos nao lancam excecao (truncamento por largura)', async () => {
  const linhaLonga = {
    ...DETALHADO[0],
    id: 2,
    descricaoEtapa: 'Uma descrição de etapa extremamente longa que certamente não cabe na coluna reservada pra ela',
    funcionario: 'UM NOME DE COLABORADOR MUITO MUITO MUITO LONGO PRA TESTAR TRUNCAMENTO',
  }
  const buffer = await gerarBuffer({
    periodoRotulo: '27 de julho de 2026',
    porCentro: PORCENTRO,
    detalhado: [linhaLonga],
    geradoEm: '27/07/2026 20:00:00',
  })
  assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-')
})
