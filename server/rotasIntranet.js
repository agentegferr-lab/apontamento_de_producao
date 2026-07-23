import express from 'express'
import { AppError, asyncRoute } from './erros.js'
import { MODULOS } from './db.js'
import { autenticar, destruirSessao, definirCookieSessao, limparCookieSessao, exigirLogin, exigirModulo } from './auth.js'
import { usuarios, papeis } from './usuarios.js'
import { avisos } from './avisos.js'
import { documentos, uploadDocumento, erroDeUpload } from './documentos.js'
import path from 'node:path'

/**
 * Rotas da intranet (login, usuarios, papeis, avisos, documentos, diretorio) — router
 * separado das rotas de apontamento em index.js pra nao inchar mais um arquivo de mais de
 * 600 linhas com um dominio diferente. Montado em '/api' antes do catch-all do SPA.
 */
export const rotasIntranet = express.Router()

// --- Autenticacao ----------------------------------------------------------------------
rotasIntranet.post(
  '/auth/login',
  asyncRoute(async (req, res) => {
    const { email, senha } = req.body ?? {}
    const resultado = autenticar(email, senha)
    if (!resultado) throw new AppError('E-mail ou senha inválidos.', 401, 'CREDENCIAIS_INVALIDAS')
    definirCookieSessao(res, resultado.token)
    res.json({ usuario: resultado.usuario })
  }),
)

rotasIntranet.post('/auth/logout', (req, res) => {
  destruirSessao(req.signedCookies?.sessao)
  limparCookieSessao(res)
  res.status(204).end()
})

rotasIntranet.get('/auth/eu', exigirLogin, (req, res) => res.json({ usuario: req.usuario }))

// --- Usuarios e papeis (admin) -----------------------------------------------------------
rotasIntranet.get(
  '/usuarios',
  exigirModulo(MODULOS.ADMIN_USUARIOS),
  (req, res) => res.json(usuarios.listar({ incluirInativos: true })),
)

rotasIntranet.post(
  '/usuarios',
  exigirModulo(MODULOS.ADMIN_USUARIOS),
  asyncRoute(async (req, res) => res.status(201).json(usuarios.criar(req.body ?? {}))),
)

rotasIntranet.patch(
  '/usuarios/:id',
  exigirModulo(MODULOS.ADMIN_USUARIOS),
  asyncRoute(async (req, res) => res.json(usuarios.atualizar(req.params.id, req.body ?? {}))),
)

rotasIntranet.get('/papeis', exigirModulo(MODULOS.ADMIN_USUARIOS), (req, res) => res.json(papeis.listar()))

rotasIntranet.patch(
  '/papeis/:id/modulos',
  exigirModulo(MODULOS.ADMIN_USUARIOS),
  asyncRoute(async (req, res) => res.json(papeis.atualizarModulos(req.params.id, req.body?.modulos))),
)

// --- Diretorio de contatos ---------------------------------------------------------------
// Nasce da propria tabela de usuarios (setor/cargo/ramal) — nao duplica cadastro.
rotasIntranet.get('/diretorio', exigirModulo(MODULOS.DIRETORIO), (req, res) => res.json(usuarios.listar()))

// --- Mural de avisos ---------------------------------------------------------------------
rotasIntranet.get('/avisos', exigirModulo(MODULOS.AVISOS), (req, res) => res.json(avisos.listar()))

rotasIntranet.post(
  '/avisos',
  exigirModulo(MODULOS.AVISOS),
  asyncRoute(async (req, res) => {
    const { titulo, corpo, fixado } = req.body ?? {}
    res.status(201).json(avisos.criar({ titulo, corpo, fixado, autorId: req.usuario.id }))
  }),
)

rotasIntranet.delete(
  '/avisos/:id',
  exigirModulo(MODULOS.AVISOS),
  asyncRoute(async (req, res) => {
    if (!avisos.remover(req.params.id)) throw new AppError('Aviso não encontrado.', 404)
    res.status(204).end()
  }),
)

// --- Documentos ----------------------------------------------------------------------------
rotasIntranet.get('/documentos', exigirModulo(MODULOS.DOCUMENTOS), (req, res) => res.json(documentos.listar()))

rotasIntranet.post(
  '/documentos',
  exigirModulo(MODULOS.DOCUMENTOS),
  (req, res, next) => uploadDocumento(req, res, (erro) => (erro ? next(erroDeUpload(erro) ?? erro) : next())),
  asyncRoute(async (req, res) => {
    if (!req.file) throw new AppError('Escolha um arquivo para enviar.', 400)
    const registro = documentos.registrar({
      nomeOriginal: req.file.originalname,
      nomeArquivo: req.file.filename,
      pasta: req.body?.pasta,
      tamanho: req.file.size,
      tipo: req.file.mimetype,
      enviadoPor: req.usuario.id,
    })
    const { caminhoArquivo: _omitido, ...publico } = registro
    res.status(201).json(publico)
  }),
)

rotasIntranet.get(
  '/documentos/:id/arquivo',
  exigirModulo(MODULOS.DOCUMENTOS),
  asyncRoute(async (req, res) => {
    const registro = documentos.obterComCaminho(req.params.id)
    if (!registro) throw new AppError('Documento não encontrado.', 404)
    // Confinado a PASTA_DOCUMENTOS pelo proprio storage do multer (nome em disco e sempre um
    // uuid gerado por nos, nunca o nome enviado pelo usuario) — path.join acima nao sai dali.
    res.download(path.resolve(registro.caminhoArquivo), registro.nome)
  }),
)

rotasIntranet.delete(
  '/documentos/:id',
  exigirModulo(MODULOS.DOCUMENTOS),
  asyncRoute(async (req, res) => {
    if (!documentos.remover(req.params.id)) throw new AppError('Documento não encontrado.', 404)
    res.status(204).end()
  }),
)
