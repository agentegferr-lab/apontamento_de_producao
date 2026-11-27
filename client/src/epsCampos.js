/** Helpers da tela de Placas EPS (ver server/eps.js pras regras). */

const p2 = (n) => String(n).padStart(2, '0')

export function chaveDia(data) {
  return `${data.getFullYear()}-${p2(data.getMonth() + 1)}-${p2(data.getDate())}`
}

/** "2026-11-03" -> "03/11/2026". */
export function dataBr(chave) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : chave ?? ''
}

/** Periodos prontos da tela: { inicio, fim } em AAAA-MM-DD, a partir de `hoje`. */
export function periodoPronto(tipo, hoje = new Date()) {
  const fim = chaveDia(hoje)
  if (tipo === 'semana') {
    const d = new Date(hoje)
    d.setDate(d.getDate() - 6)
    return { inicio: chaveDia(d), fim }
  }
  if (tipo === 'mes') return { inicio: `${hoje.getFullYear()}-${p2(hoje.getMonth() + 1)}-01`, fim }
  return { inicio: fim, fim }
}

/** Previa ao digitar: esperado, diferenca e rendimento (mesma conta de calcularEps no servidor). */
export function previaEps(tipo, blocos, placas) {
  const b = Number(blocos)
  if (!tipo || !Number.isInteger(b) || b < 1) return null
  const esperado = b * tipo.placasPorBloco
  const informado = placas === '' || placas == null ? null : Number(placas)
  if (informado == null || !Number.isInteger(informado) || informado < 0) return { esperado, diferenca: null, rendimento: null }
  return { esperado, diferenca: informado - esperado, rendimento: esperado > 0 ? informado / esperado : null }
}

export function formatarRendimento(r) {
  return r == null ? '—' : `${(r * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

/** CSV pro Excel brasileiro: ponto e virgula, BOM, aspas escapadas. */
export function csvDosLancamentos(lancamentos) {
  const campo = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const linhas = [
    ['Data', 'Colaborador', 'Matrícula', 'Tipo', 'Blocos usados', 'Placas produzidas', 'Esperado', 'Diferença', 'Rendimento', 'Metros', 'Valor (R$)', 'Observação'].map(campo).join(';'),
    ...lancamentos.map((l) =>
      [
        dataBr(l.data),
        l.colaborador?.nome,
        l.colaborador?.matricula,
        l.tipoRotulo,
        l.blocos,
        l.placas,
        l.esperado,
        l.diferenca,
        l.rendimento == null ? '' : (l.rendimento * 100).toFixed(1).replace('.', ',') + '%',
        l.metros,
        l.valor == null ? '' : l.valor.toFixed(2).replace('.', ','),
        l.observacao,
      ]
        .map(campo)
        .join(';'),
    ),
  ]
  return '﻿' + linhas.join('\r\n')
}
