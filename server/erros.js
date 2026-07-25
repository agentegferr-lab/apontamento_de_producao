/** Erro de aplicacao com status HTTP — extraido de index.js pra ser reutilizavel pelos
 * modulos novos (caminhoes.js, motoristas.js, entregas.js) sem criar import circular. */
export class AppError extends Error {
  constructor(mensagem, status = 400, codigo) {
    super(mensagem)
    this.status = status
    this.codigo = codigo
  }
}

/** Encaminha rejeicoes de handler assincrono pro middleware de erro do Express. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
