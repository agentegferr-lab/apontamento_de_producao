/**
 * Itens do menu da intranet — chaves identicas as de server/db.js (MODULOS). Nao ha modulo
 * compartilhado entre client/server (bundles separados), entao um modulo novo no servidor
 * precisa ganhar uma linha aqui tambem pra aparecer no menu.
 *
 * `grupo` agrupa os itens visualmente na barra lateral (IntranetShell.jsx) — a ordem dos
 * grupos segue a primeira ocorrencia neles nesta lista.
 */
export const ITENS_MENU = [
  { chave: 'avisos', rota: '/', rotulo: 'Mural', grupo: 'Geral' },
  { chave: 'diretorio', rota: '/diretorio', rotulo: 'Diretório', grupo: 'Geral' },
  { chave: 'terminal.apontamento', rota: '/terminal/apontamento', rotulo: 'Apontamento', grupo: 'Produção' },
  { chave: 'terminal.acompanhamento', rota: '/terminal/acompanhamento', rotulo: 'Acompanhamento', grupo: 'Produção' },
  { chave: 'terminal.planejamento', rota: '/terminal/planejamento', rotulo: 'Planejamento', grupo: 'PCP' },
  { chave: 'admin.usuarios', rota: '/admin/usuarios', rotulo: 'Usuários', grupo: 'Administração' },
]
