import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

/**
 * Armazena os apontamentos EM ANDAMENTO — os que ja comecaram mas ainda nao foram
 * gravados no Nomus.
 *
 * Por que no servidor e nao no navegador: a API do Nomus nao deixa abrir um apontamento
 * sem fecha-lo (o POST exige inicio e fim juntos), entao o "em andamento" nao existe no
 * ERP. Se ele vivesse no localStorage de cada terminal, o terminal da Pintura nao teria
 * como saber o que o Corte esta produzindo — e o kanban de acompanhamento seria
 * impossivel. Ficando aqui, todos os terminais enxergam a mesma producao.
 *
 * SEGMENTOS: um mesmo trabalho vira varios intervalos quando o operador pausa (almoco,
 * quebra de maquina...). Cada segmento fechado fica em `segmentos` e so no Finalizar todos
 * viram apontamentos no Nomus — um por segmento, cada um com sua atividade. Gravar na
 * pausa seria pior: o kanban trata "etapa tem apontamento" como etapa concluida, e o card
 * pularia de coluna no meio do almoco.
 *
 * Isto e a UNICA copia desses apontamentos ate o Finalizar. Por isso toda escrita vai pro
 * disco na hora e de forma atomica (grava em .tmp e renomeia): um desligamento no meio da
 * gravacao nao pode corromper o arquivo e perder o turno inteiro.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = process.env.ARQUIVO_ANDAMENTO
  ? path.resolve(process.env.ARQUIVO_ANDAMENTO)
  : path.join(__dirname, '..', 'dados', 'andamento.json')

export const PRODUZINDO = 'PRODUZINDO'
export const PAUSADO = 'PAUSADO'

let emAndamento = []

function carregar() {
  try {
    const bruto = fs.readFileSync(ARQUIVO, 'utf8')
    const dados = JSON.parse(bruto)
    emAndamento = Array.isArray(dados) ? dados : []
    console.log(`[andamento] ${emAndamento.length} apontamento(s) em andamento recuperado(s)`)
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      // Nao apaga o arquivo: se estiver corrompido, o operador ainda pode recuperar os
      // horarios na mao. Melhor subir vazio e gritar do que sobrescrever a evidencia.
      console.error(`[andamento] ARQUIVO ILEGIVEL (${ARQUIVO}) — subindo vazio:`, erro.message)
    }
    emAndamento = []
  }
}

function gravar() {
  const temporario = `${ARQUIVO}.tmp`
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
  fs.writeFileSync(temporario, JSON.stringify(emAndamento, null, 2), 'utf8')
  fs.renameSync(temporario, ARQUIVO) // rename e atomico no mesmo volume
}

carregar()

export const andamento = {
  listar() {
    return [...emAndamento]
  },

  porOperacao(idOperacaoOrdem) {
    return emAndamento.find((a) => Number(a.idOperacaoOrdem) === Number(idOperacaoOrdem)) ?? null
  },

  iniciar(dados) {
    const registro = {
      id: crypto.randomUUID(),
      estado: PRODUZINDO,
      paradaAtual: null,
      segmentos: [],
      ...dados,
    }
    emAndamento.push(registro)
    gravar()
    return registro
  },

  /**
   * Fecha o intervalo em curso. Passando `abrir`, ja comeca o proximo — e assim que o
   * pausar e o retomar funcionam. Sem `abrir`, so encerra (usado no Finalizar).
   */
  fecharSegmento(id, fim, abrir) {
    const registro = emAndamento.find((a) => a.id === id)
    if (!registro || !registro.dataHoraInicial) return registro ?? null

    const pausado = registro.estado === PAUSADO
    registro.segmentos.push({
      tipo: pausado ? 'PARADA' : 'PRODUCAO',
      idAtividade: pausado ? registro.paradaAtual.idAtividade : registro.idAtividade,
      nomeAtividade: pausado ? registro.paradaAtual.nomeAtividade : registro.nomeAtividade,
      inicio: registro.dataHoraInicial,
      fim,
      enviado: false,
    })

    registro.estado = abrir?.estado ?? registro.estado
    registro.paradaAtual = abrir?.paradaAtual ?? null
    registro.dataHoraInicial = abrir?.inicio ?? null
    gravar()
    return registro
  },

  /** Marca um segmento como ja gravado no Nomus, pra um retry nao duplicar apontamento. */
  marcarEnviado(id, indice) {
    const registro = emAndamento.find((a) => a.id === id)
    if (!registro?.segmentos[indice]) return
    registro.segmentos[indice].enviado = true
    gravar()
  },

  remover(id) {
    const antes = emAndamento.length
    emAndamento = emAndamento.filter((a) => a.id !== id)
    if (emAndamento.length !== antes) gravar()
    return antes !== emAndamento.length
  },

  contarPorFuncionario(idFuncionario) {
    return emAndamento.filter((a) => Number(a.idFuncionario) === Number(idFuncionario)).length
  },
}
