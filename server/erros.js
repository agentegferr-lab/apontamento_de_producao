/** Erro de aplicacao com status HTTP — extraido de index.js pra ser reutilizavel pelos
 * modulos novos da intranet (usuarios.js, avisos.js, documentos.js, rotasIntranet.js) sem
 * criar import circular com index.js. */
export class AppError extends Error {
  constructor(mensagem, status = 400, codigo) {
    super(mensagem)
    this.status = status
    this.codigo = codigo
  }
}

/** Encaminha rejeicoes de handler assincrono pro middleware de erro do Express. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
