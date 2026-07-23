# Grupo Ferro — Intranet

Começou como um terminal touchscreen de chão de fábrica que substitui a tela de apontamento
do Nomus ERP, integrando pela API REST, e está crescendo para uma intranet completa da
empresa — login por usuário, papéis/permissões por módulo, e módulos além da produção. Hoje:

1. **Apontamento** — lê a etiqueta da ordem de serviço e a da etapa do processo, e o
   operador escolhe **Iniciar**, **Pausar** ou **Finalizar** processo.
2. **Acompanhamento** — quadro kanban das ordens andando pelo roteiro de produção.
3. **Planejamento (PCP)** — calendário mensal pra agendar quando cada ordem começa a ser
   produzida.
4. **Mural de avisos**, **Diretório de contatos** e **Documentos** — módulos gerais da
   intranet, ver [Intranet: login e permissões](#intranet-login-e-permissões) abaixo.

Cada operador loga com e-mail e senha — inclusive no terminal touch do chão de fábrica, que
deixou de ter matrícula fixa por `.env` (ver seção de login). O que cada um vê no menu
depende do **papel** do seu usuário (Admin, Operador, PCP, Supervisor, RH — configurável).

---

## Intranet: login e permissões

- **Login por e-mail/senha**, sessão em cookie httpOnly (`server/auth.js`), sem
  `express-session`/`passport` — token opaco guardado numa tabela `sessoes` do SQLite,
  senha em `scrypt` (nativo do Node, sem dependência extra).
- **Banco**: `node:sqlite` (embutido no Node desde a 22.5 — sem addon nativo pra compilar,
  por isso o Dockerfile usa `node:22-alpine` e não precisa de toolchain de build). Um
  arquivo só, `dados/intranet.db` (`ARQUIVO_DB`), no mesmo volume que já existia.
- **Papéis e módulos** (`server/db.js`, `MODULOS`): cada usuário tem um papel; cada papel
  tem uma lista de módulos liberados. Sem permissão granular por ação nesta fase — só
  visibilidade de módulo (quem tem "avisos" pode publicar E remover avisos, por exemplo).
  Papéis padrão semeados no primeiro boot: **Admin** (tudo, incluindo Usuários),
  **Operador** (Apontamento/Acompanhamento/Mural/Diretório), **PCP** (+ Planejamento e
  Documentos), **Supervisor**, **RH** — editáveis depois pela tela de Usuários.
- **Primeiro admin**: se a tabela de usuários estiver vazia no boot, `server/bootstrap.js`
  cria um admin a partir de `ADMIN_EMAIL_INICIAL`/`ADMIN_SENHA_INICIAL` do `.env` — troque a
  senha assim que entrar pela primeira vez. Depois disso essas duas variáveis não têm mais
  efeito (só rodam contra tabela vazia) e podem ser removidas do `.env`.
- **Terminal (Apontamento) sem matrícula fixa**: cada usuário com o módulo Apontamento
  cadastra a própria `matricula_nomus` (aba Usuários). O que era `NOMUS_MATRICULA` fixo por
  `.env` virou um campo por pessoa — todo operador que for usar o terminal precisa da
  matrícula preenchida no cadastro **antes** do primeiro apontamento.
- **Roadmap** (não implementado ainda): RH (ponto, férias), relatórios/dashboards
  gerenciais (OEE, produtividade), calendário de eventos/feriados, solicitações internas
  (chamados), permissão granular por ação além de visibilidade de módulo.

---

## A limitação do Nomus que molda todo o projeto

A API REST do Nomus **não tem endpoint de edição de apontamento**. Existem apenas:

| Endpoint | Serve para |
|---|---|
| `GET /apontamentos` | listar |
| `GET /apontamentos/{id}` | detalhar |
| `POST /apontamentos` | inserir — **exige `dataHoraInicial` e `dataHoraFinal` juntos** |
| `PUT /apontamentos/{id}/moverParaLixeira` | excluir (soft delete) |

Não dá para abrir um apontamento e fechá-lo depois. Consequências práticas:

- **Enquanto um processo está em andamento, ele não existe no Nomus.** Não aparece para
  supervisores nem em relatórios do ERP. Ele só é gravado no instante do *Finalizar*.
- **Esse estado "em andamento" mora neste app**, em `dados/andamento.json` no servidor —
  é a **única cópia** até o processo ser finalizado. Inclua esse arquivo no backup.
- Por isso o "em andamento" fica **no servidor e não no navegador**: se vivesse no
  `localStorage` de cada terminal, o terminal da Pintura não teria como saber o que o
  Corte está produzindo, e o quadro de acompanhamento seria impossível.

Isso é limitação da API do Nomus, não do app.

---

## Como o quadro decide a coluna

A ordem aparece no **centro de trabalho da sua primeira operação ainda não apontada**. É
o que faz o card andar sozinho: fechou o corte, a próxima pendente passa a ser a pintura,
e a ordem muda de coluna sem ninguém arrastar nada.

| Status | Quando |
|---|---|
| `EM PRODUÇÃO` | há um apontamento aberto nessa etapa agora (cronômetro correndo) |
| `PARADO` | iniciado, mas pausado agora — o card mostra o motivo e há quanto tempo |
| `AGUARDANDO` | a etapa é a próxima pendente, mas ninguém iniciou |
| `CONCLUÍDO` | todas as etapas do roteiro já foram apontadas |

Uma exceção à regra: se houver uma etapa **aberta**, ela ganha da "primeira pendente". Sem
isso, alguém que comece a pintura antes de o corte ser apontado ficaria com a ordem parada
no corte como `AGUARDANDO` — escondendo do quadro um trabalho que está acontecendo.

A **ordem das colunas** é derivada dos dados, não fixa no código: cada centro herda o
menor número de operação em que aparece nos roteiros. Corte (10) vem antes de Pintura (20)
naturalmente — abriu um centro novo no Nomus, ele entra na posição certa sozinho.

Só esses três status são derivávies da API hoje. Status como `EM TRANSPORTE`, `ENTREGUE` ou
`AGUARDANDO CARGA` precisariam de uma fonte que a API de apontamentos não tem.

---

## Planejamento (PCP)

Terceira aba do terminal: um calendário mensal onde o PCP arrasta ordens da fila invisível
(`filaAguardando`, ver acima) para o dia em que devem começar a ser produzidas.

- **É só nosso — nunca toca o Nomus.** Guardado em `dados/planejamento.json`
  (`server/planejamento.js`), no mesmo padrão de `andamento.js`: array em memória,
  persistido em disco a cada escrita, atômico (grava em `.tmp` e renomeia). Não existe
  campo confirmado na API do Nomus para "data planejada de início" que aceite escrita (ver
  o incidente do "reporte da produção" — nem tudo que a tela mostra tem endpoint de API).
- Cada item guarda um **retrato** da ordem no momento de agendar (`nomeOrdem`, `pedido`,
  `produto`) — se a ordem começar a ser produzida de verdade depois, o card no calendário
  não desaparece nem quebra sozinho; quem tira do calendário é o PCP, arrastando de volta
  pra fila ou clicando no "×".
- Arrastar e soltar é feito com a API nativa de Drag and Drop do HTML5 (sem biblioteca
  nova). Idempotente por `idOperacaoOrdem`: soltar a mesma ordem duas vezes não duplica.

---

## Identidade

Barra preta com **GFERRO** em amarelo (`#f5d211`), sem arquivo de imagem. No resto da tela o
amarelo entra só como acento (aba ativa, EM PRODUÇÃO, foco do campo) sobre fundo neutro:
amarelo em tela cheia cansa a vista num turno de 8 horas e não deixa nada se destacar.
Amarelo sempre leva texto preto — amarelo com branco não passa em nenhum critério de
contraste.

## Rodando

Requer **Node 22.5+** (usa `node:sqlite`, embutido no Node — sem instalação extra).

```bash
npm install
cp .env.example .env    # preencha NOMUS_API_KEY, SESSION_SECRET, ADMIN_EMAIL_INICIAL/ADMIN_SENHA_INICIAL
npm run build
npm start               # http://localhost:3000 — loga com o admin inicial e troque a senha
```

Desenvolvimento (Vite + Express com reload):

```bash
npm run dev             # front no :5173, backend no :3000
npm test                # testes do resolver de código de barras, kanban, login/usuários/avisos/documentos
```

### Testar sem tocar no ERP de produção

O repositório traz um **Nomus falso** com ordens, roteiro e atividades de mentira:

```bash
node mock/nomus-fake.js                   # sobe em :4000
# aponte NOMUS_BASE_URL do seu .env pra http://localhost:4000/rest antes de subir
npm start
```

Ordens de teste: `12345`, `12346`, `99887`, `12350`, `12351`.
Etapas: `10`=Corte, `20`=Pintura, `30`=Colagem, `40`=Expedição, `50`=Logística.
Matrícula de teste: `1234` (cadastre na tela de Usuários pro operador de teste).

Para exercitar o throttling do Nomus (HTTP 429), suba o mock com `MOCK_THROTTLE=0.3`.
Para simular um Nomus que ignora o filtro `?nomeOrdem`, use `MOCK_IGNORA_FILTRO=1`.

---

## Deploy (EasyPanel / Docker)

O `Dockerfile` na raiz faz um build multi-stage: builda o cliente (Vite) e sobe so o
Express + `dist/` + dependencias de producao — o resultado ja e o terminal completo,
servindo front e back na mesma porta.

No EasyPanel, crie um serviço **App** (não Compose) apontando pro repositório Git:

1. **Origem**: repositório Git (GitHub/GitLab) com este projeto. O EasyPanel detecta o
   `Dockerfile` sozinho — não precisa configurar build command nem start command.
2. **Porta**: `3000` (mesma do `EXPOSE` do Dockerfile e do `PORT` padrão do `.env.example`).
   Health check, se o EasyPanel pedir: `GET /api/saude`.
3. **Variáveis de ambiente** — copie da lista em [Configuração](#configuração) abaixo.
   Nunca suba o `.env` pro repositório (ele já está no `.gitignore`); no EasyPanel essas
   variáveis vão na aba de Environment Variables do serviço, não em arquivo:
   - `NOMUS_API_KEY` (ou `NOMUS_USUARIO_SENHA`)
   - `NOMUS_BASE_URL`
   - `NOMUS_ATIVIDADE_PADRAO` (opcional, mas recomendado — ver seção de Configuração)
   - `SESSION_SECRET` (obrigatório — gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `ADMIN_EMAIL_INICIAL` / `ADMIN_SENHA_INICIAL` (só têm efeito no 1º boot, pra criar o admin)
4. **Volume persistente — obrigatório**: monte um volume em `/app/dados`. É a ÚNICA cópia
   dos apontamentos **em andamento** (quem começou mas ainda não finalizou), do cache do
   Nomus **e agora também do banco da intranet** (`intranet.db` — usuários, papéis, avisos,
   documentos) — sem volume, todo redeploy apaga tudo isso, inclusive as contas cadastradas
   (ver [Cache](#cache-persistido-em-disco-nunca-bloqueia-por-um-restart)
   e o incidente de avalanche de 429 documentado ali). A pasta é criada sozinha na primeira
   escrita, não precisa existir de antemão no volume.
5. Depois do primeiro deploy, rode o [diagnóstico](#antes-de-apontar-uma-ordem-de-verdade-rode-o-diagnóstico)
   uma vez contra o Nomus real antes de liberar o terminal pro operador.

---

## Configuração

Tudo em `.env` (veja `.env.example` para a lista completa):

| Variável | Obrigatória | O que faz |
|---|---|---|
| `NOMUS_API_KEY` | sim¹ | chave Base64 de integração. **Nunca chega ao browser** |
| `SESSION_SECRET` | sim | assina o cookie de sessão da intranet — trocar derruba todo login |
| `ADMIN_EMAIL_INICIAL` / `ADMIN_SENHA_INICIAL` | só no 1º boot | cria o admin inicial se não houver nenhum usuário ainda |
| `NOMUS_BASE_URL` | não | padrão: a URL de produção da Constelha |
| `NOMUS_MATRICULA` | não | só fallback pra dev/mock — cada operador tem a própria matrícula (aba Usuários) |
| `NOMUS_ATIVIDADE_PADRAO` | não | atividade padrão **por nome** (ex.: `Producao`) |
| `NOMUS_ATIVIDADES_PARADA` | não | quais atividades são motivo de parada (ver abaixo) |
| `NOMUS_ENDPOINT_ORDENS` | não | de onde vem o número do pedido (ver abaixo) |
| `ARQUIVO_ANDAMENTO` | não | onde ficam os apontamentos em andamento (**faça backup**) |
| `ARQUIVO_DB` | não | banco da intranet — usuários/papéis/avisos/documentos (**faça backup**) |
| `ARQUIVO_DOCUMENTOS_DIR` | não | onde os arquivos do módulo Documentos são gravados |

¹ ou `NOMUS_USUARIO_SENHA` no formato `usuario:senha`.

**Não existe configuração de recurso.** O terminal aponta as ordens de todos os setores,
então o recurso sai do **centro de trabalho da etapa lida** — quem digita muda a cada
leitura, mas onde o trabalho aconteceu é o que o Nomus grava em `idRecurso`. A resolução é
sempre automática: o operador nunca escolhe máquina.

Se um centro de trabalho tiver mais de um recurso, o apontamento cai no primeiro ativo
(ordenado por id, para ser sempre o mesmo) e o log avisa uma vez. Se algum dia for preciso
apontar numa máquina específica, o caminho é o cadastro do Nomus ter um centro de trabalho
por máquina — não uma pergunta na tela.

A atividade padrão casa **por nome** e não por id: cada recurso tem sua própria "Produção"
com id diferente, então um id fixo só valeria para um setor.

**A chave nunca vai para o front-end.** O React só conversa com o Express local, que
guarda a chave em variável de ambiente e repassa as chamadas ao Nomus. O `idFuncionario`
gravado no apontamento também vem sempre do servidor, nunca do cliente.

---

## Decisões que valem saber

- **Dois códigos de barras, não um.** A ordem tem uma etiqueta e o processo tem outra. Cada
  código é o `id` interno do registro no Nomus (`idOrdem` e `id` da operação,
  respectivamente) — não o número impresso ao lado nem o de exibição da etapa ("Op. 10").
  O `id` da operação sozinho já resolve; o código da ordem serve de conferência. Etiquetas
  com zero à esquerda ou parênteses são normalizadas.
- **Finalizar é reler os mesmos dois códigos**, não clicar num card — o operador não
  precisa procurar nada na tela.
- **A atividade decide o que é perguntado.** Se ela tiver `aptQtdProduzida`, o app pede a
  quantidade no Finalizar; `aptPercentualProdAndamento` pede o percentual. O tempo já
  cronometrado fica guardado enquanto o operador digita.
- **O fim é o instante do toque em Finalizar**, não o do Confirmar: os segundos gastos
  preenchendo a quantidade não entram no apontamento.
- **Sem retry automático em 5xx.** Um `POST /apontamentos` que falhou por erro do servidor
  pode ter gravado; reenviar duplicaria o apontamento. Em `429` (throttling) o retry é
  automático, respeitando o `tempoAteLiberar` da resposta.
- **Nada some quando o Nomus cai.** O apontamento em andamento continua no servidor e pode
  ser finalizado quando a conexão voltar. Já verificado matando o processo no meio.

## Pausar: por que a pausa não vai ao Nomus na hora

Pausar **não pode ser só congelar o cronômetro**: como o `POST` grava um intervalo único, o
tempo do almoço entraria como tempo produzido. E gravar na pausa também não serve — o quadro
trata "etapa tem apontamento" como etapa concluída, e o card pularia de coluna no meio do
almoço.

A solução são **segmentos**. Pausar fecha o intervalo de produção e abre um de parada, tudo
local. Só no Finalizar é gravado **um apontamento por segmento**, cada um com sua atividade:

```
Iniciar 08:00 → Pausar 10:00 (refeição) → Iniciar 11:00 → Finalizar 12:00
  vira 3 apontamentos:  Produção 08:00-10:00 · Refeição 10:00-11:00 · Produção 11:00-12:00
```

Consequências que valem saber:

- **Uma etapa passa a ter vários apontamentos no Nomus**, não um. É o que permite ao ERP
  separar tempo produzido de tempo parado.
- **Os motivos são atividades do próprio Nomus**, então a parada vira apontamento real e o
  supervisor a vê em relatório com o motivo certo.
- **Se um POST falhar no meio**, os anteriores já estão no Nomus e não há endpoint para
  desfazer. Por isso cada segmento é marcado como enviado assim que grava: uma nova tentativa
  manda só o que falta, sem duplicar.
- **A quantidade vai toda no último segmento de produção.** Reparti-la entre os intervalos
  seria inventar dado — ninguém sabe quanto saiu antes e depois do almoço. O total da
  operação, que é o que o Nomus soma, fica correto.
- **Retomar é o próprio Iniciar**: ler as etiquetas de um processo pausado e tocar em Iniciar
  fecha a parada e volta a produzir.

## Antes de apontar uma ordem de verdade: rode o diagnóstico

**Todo o desenvolvimento foi validado contra `mock/nomus-fake.js`, um Nomus falso escrito
junto com o app.** Ele testa a lógica, mas não as suposições: devolve exatamente o que se
presumiu que a API devolve, então nunca contradiz. Antes do primeiro apontamento real:

```bash
# com o .env apontando para o Nomus REAL
node ferramentas/diagnostico.js              # confere a API inteira
node ferramentas/diagnostico.js 1504 2739    # + testa os dois codigos de uma etiqueta real
```

Só faz GET — não cria, não altera e não apaga nada. Confere a chave, a matrícula, os
recursos, o roteiro inteiro (paginado até o fim, com `recursosPlanejados`), o
cruzamento centro×recurso, as atividades, os apontamentos já gravados, o número do pedido
e, se informados, os dois códigos de uma etiqueta real. **Ele mesmo tomou um 429 do Nomus
em produção durante o desenvolvimento** — respeita o `tempoAteLiberar` e espera entre
chamadas, mas ainda assim evite rodá-lo em sequência rápida.

## O que já foi confirmado contra o Nomus real (2026-07-15)

- **O código de barras é o `id` interno do registro, não o número impresso ao lado.** O
  código da ORDEM é o campo `idOrdem`; o do PROCESSO é o `id` da própria operação do
  roteiro — não `nomeOrdem` ("OS 01444 - 001") nem o número de exibição da etapa ("Op. 10").
  Confirmado com **duas** OS físicas diferentes (uma comparando o número impresso sob cada
  código de barras com o registro real da API). A resolução ficou mais simples do que a
  suposição original: o `id` da operação sozinho já identifica o registro sem ambiguidade —
  o código da ordem serve de conferência, não de busca (`server/resolver.js`).
- **As listas paginam em silêncio: `?pagina=N`, 50 por página, começando em 1** — sem
  metadados na resposta. Um `GET` sem esse parâmetro só traz a página 1. É isso que fazia o
  resolver não achar ordens fora dessa janela: não era campo errado, era paginação nunca
  percorrida. `server/nomus.js` agora pagina até o fim em toda lista.
- **O pedido não é um campo — é um cruzamento**: `GET /ordens[].itensPedido[0].idPedido`
  resolvido contra `GET /pedidos/{id}` (busca por **um** id, nunca a listagem inteira —
  `/pedidos` tem milhares de registros e é fortemente limitado por rate limit). O código é
  `pedidos[].codigoPedido` (ex.: `"PD 01294"`); o cliente já vem em
  `ordens[].itensPedido[0].nomeCliente`. `/ordensProducao` **não existe** nesta API.
- **O recurso pode vir direto da operação.** Cada item do roteiro pode trazer
  `recursosPlanejados: [{ id, nomeRecurso, ... }]` — quando presente, `server/recursos.js`
  usa isso direto, sem casar nome de centro de trabalho contra `/recursos` (o que elimina a
  ambiguidade de um centro ter várias máquinas). O casamento por centro segue como reserva.
- **As atividades reais não incluem "refeição" nem "banheiro"** — o cadastro observado foi:
  `Falta de operador, Manutenção corretiva, Manutenção preventiva, Falta de energia, Falta
  de programação, Produção, Setup`. Se quiser esses motivos específicos no botão Pausar,
  precisam ser cadastrados como atividade no Nomus antes.
- **`POST /apontamentos` exige `DD/MM/YYYY HH:mm:ss`, não ISO** — confirmado com um `POST`
  de teste real contra a produção (autorizado pelo usuário; ordem de teste, atividade Setup,
  duração de 1 segundo, removido depois). Enviar ISO é rejeitado com HTTP 406 e a mensagem
  *"O campo dataHoraInicial está preenchido em formato incorreto"* — ou seja, o risco real
  não era gravar data errada em silêncio, era simplesmente **nenhum apontamento ser aceito**.
  `server/index.js` converte para o formato certo só na borda com o Nomus
  (`paraFormatoNomus`); internamente o app continua em ISO, que ordena certo como string
  (BR não ordena). Essa mesma confirmação revelou um bug: `server/kanban.js` lia as datas
  do `GET /apontamentos` com `Date.parse`, que não interpreta `DD/MM/YYYY` de forma
  confiável — corrigido com um parser manual (`parseDataNomus`).

Essas confirmações vieram de comparar com um projeto irmão (`Gferro`, um dashboard) que já
integra com este mesmo Nomus/mesma empresa há dias — mesma API, mesmo `NOMUS_BASE_URL` — e
de um `POST` de teste controlado quando o irmão não cobria a pergunta (ele só lê, nunca
grava).

## O que ainda está em aberto — precisa de mais uma informação sua

1. **Matrícula real do terminal.** `NOMUS_MATRICULA` ainda está com o valor de teste `1234`,
   que não existe no Nomus.
2. **Limpeza manual pendente no Nomus.** O teste de formato de data criou (e o script devia
   remover) o apontamento `id 37` na OS 01444-001 — 1 segundo de duração, atividade Setup,
   sem efeito em quantidade produzida. A tentativa automática de mandar pra lixeira falhou:
   `PUT /apontamentos/{id}/moverParaLixeira`, documentado no início do projeto, **não existe
   nesse caminho** (retorna 404; `OPTIONS` confirma que `/apontamentos/{id}` só aceita
   `GET`). Não afeta o funcionamento do app — ele nunca chama esse endpoint em operação
   normal — mas o registro id 37 precisa ser removido manualmente pela tela do Nomus, e o
   endpoint certo de lixeira ainda não foi encontrado.

## Limitações conhecidas

- **Sem Nomus, não dá para iniciar processo novo**: a leitura precisa resolver a ordem
  contra o ERP. O que já está em andamento não se perde.
- **Cada operador precisa da própria conta com `matricula_nomus` cadastrada** (aba
  Usuários) antes de conseguir apontar — sem isso o Iniciar falha com um erro claro
  (`SEM_MATRICULA`) em vez de usar a matrícula de outra pessoa.
- **Uma varredura completa de `/operacoesRoteiroOrdem` ou `/apontamentos` pode levar dezenas
  de segundos** (paginação real, 50 por página) — por isso o cache dessas listas tem TTL de
  3 minutos (`CACHE_TTL_MS`), não segundos.

## Cache: persistido em disco, nunca bloqueia por um restart

**Incidente em 2026-07-15:** durante testes, vários restarts seguidos do servidor zeraram
o cache (só vivia em memória) repetidas vezes, forçando uma varredura completa cara a cada
restart — em cima de uma API já sob rate limit, isso deixou o kanban sem carregar por um
bom tempo. Duas correções:

1. **`server/pedidos.js` martelava a API sem pausa.** A primeira versão buscava o pedido de
   cada ordem sem pausa entre chamadas e com até 3 tentativas por item em 429 — com uma
   empresa de ~880 ordens e cache frio, isso virou uma avalanche que consumiu a cota
   compartilhada da chave (afetando até rotas que nem usam pedido, como o Iniciar). Corrigido
   com pausa entre chamadas novas (`PEDIDO_PAUSA_MS`), sem retry para pedido (é dado
   complementar — se falhar agora, o próximo ciclo tenta de novo) e um teto de quantos
   pedidos **novos** busca por chamada (`PEDIDO_MAX_NOVOS_POR_CICLO`, padrão 20) — o resto
   aparece nos cards ao longo dos ciclos seguintes, sem travar a tela.
2. **O cache de operações/apontamentos/ordens agora persiste em disco** (`ARQUIVO_CACHE_NOMUS`,
   padrão `dados/cache-nomus.json`) com *stale-while-revalidate*: quando o valor em cache
   está vencido mas existe, o app devolve o valor antigo **na hora** e atualiza em segundo
   plano — só espera de verdade quando não há absolutamente nada em cache (o primeiro boot
   de todos). Um restart do terminal (queda de energia, deploy, reinício manual) nunca mais
   força a tela a esperar uma varredura inteira.
