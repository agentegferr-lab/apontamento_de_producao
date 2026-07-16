/**
 * Le uma data local "YYYY-MM-DDTHH:mm:ss" (o formato que o Nomus usa, sem fuso) como Date
 * no fuso do terminal. new Date(texto) trataria a string como UTC em alguns browsers e
 * jogaria o cronometro 3h fora.
 */
export function parseLocalISO(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(texto ?? '')
  if (!m) return null
  const [, a, mes, d, h, min, s] = m.map(Number)
  return new Date(a, mes - 1, d, h, min, s)
}

/**
 * Instante local no formato do Nomus. Usado pra carimbar o toque em FINALIZAR: o servidor
 * confere a janela e usa esse horario, pra que os segundos gastos digitando a quantidade
 * nao entrem como tempo produzido. toISOString() nao serve — converte pra UTC.
 */
export function agoraLocalISO(data = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}` +
    `T${p(data.getHours())}:${p(data.getMinutes())}:${p(data.getSeconds())}`
  )
}

/** Milissegundos -> "HH:MM:SS" (as horas passam de 24 sem estourar). */
export function formatarDuracao(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`
}
