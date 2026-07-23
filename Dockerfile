# node:22 (nao 20): a intranet usa node:sqlite, embutido no Node desde a 22.5 — sem addon
# nativo pra compilar, entao nao precisa de toolchain de build (python/make/g++) na imagem.
# Build do cliente (Vite) — precisa das devDependencies (vite, plugin-react).
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Imagem final: so o servidor Express + o build estatico do cliente + deps de producao.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# O servidor carimba dataHoraInicial/Final com o relogio local do container (ver
# server/index.js, agoraLocalISO) — isso so bate com o cronometro do navegador (e com o
# horario real gravado no Nomus) se o container pensar que esta no fuso do Brasil. Imagem
# Alpine nao traz tzdata por padrao: sem o pacote, TZ vira no-op e o container fica em UTC
# mesmo assim, 3h a frente do horario de Brasilia.
RUN apk add --no-cache tzdata
ENV TZ=America/Sao_Paulo
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server

# dados/ e criado sozinho na primeira escrita (cache e apontamentos em andamento) — ver
# server/nomus.js, pedidos.js, andamento.js. Precisa ser um volume persistente (ver README):
# e a UNICA copia dos apontamentos em andamento ate o Finalizar.
EXPOSE 3000
CMD ["node", "server/index.js"]
