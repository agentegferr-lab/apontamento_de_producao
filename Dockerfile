# Build do cliente (Vite) — precisa das devDependencies (vite, plugin-react).
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Imagem final: so o servidor Express + o build estatico do cliente + deps de producao.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server

# dados/ e criado sozinho na primeira escrita (cache e apontamentos em andamento) — ver
# server/nomus.js, pedidos.js, andamento.js. Precisa ser um volume persistente (ver README):
# e a UNICA copia dos apontamentos em andamento ate o Finalizar.
EXPOSE 3000
CMD ["node", "server/index.js"]
