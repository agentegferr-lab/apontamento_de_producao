/**
 * Itens do menu da intranet — chaves identicas as de server/db.js (MODULOS). Nao ha modulo
 * compartilhado entre client/server (bundles separados), entao um modulo novo no servidor
 * precisa ganhar uma linha aqui tambem pra aparecer no menu.
 */
export const ITENS_MENU = [
  { chave: 'avisos', rota: '/', rotulo: 'Mural' },
  { chave: 'diretorio', rota: '/diretorio', rotulo: 'Diretório' },
  { chave: 'documentos', rota: '/documentos', rotulo: 'Documentos' },
  { chave: 'terminal.apontamento', rota: '/terminal/apontamento', rotulo: 'Apontamento' },
  { chave: 'terminal.acompanhamento', rota: '/terminal/acompanhamento', rotulo: 'Acompanhamento' },
  { chave: 'terminal.planejamento', rota: '/terminal/planejamento', rotulo: 'Planejamento' },
  { chave: 'admin.usuarios', rota: '/admin/usuarios', rotulo: 'Usuários' },
]
