# syntax=docker/dockerfile:1

# Build de produção do apps/api (Fase 6 — PRD §15/§17).
#
# Instala o monorepo INTEIRO (não usa `turbo prune`) — mais simples e mais
# fácil de verificar corretude num único build local; poda seletiva de
# workspaces é uma otimização de tamanho de imagem pendente, não um requisito
# de correção.
#
# Roda via `tsx`, não `node` puro, no runtime (ver package.json,
# `start:prod`) — decisão deliberada: packages/config, packages/database e
# packages/shared-types exportam TypeScript fonte diretamente (`main` aponta
# pra .ts, não pra um dist compilado — decisão da Fase 1, nunca revisitada).
# `node` sozinho não consegue `require()` esses arquivos; `tsx` registra um
# loader que transpila on-the-fly qualquer import de workspace que o
# `nest build` (que só compila o próprio apps/api) deixou como está. O código
# do próprio apps/api já vem pré-compilado (dist/main.js) — só as 3
# dependências internas passam por essa transpilação em runtime, não a
# aplicação inteira; o custo é um cold-start levemente maior, não repetido
# por request. Testado localmente (`docker build` + `docker run` contra o
# Postgres/Redis reais do docker-compose) antes de considerar este arquivo
# pronto — ver PR.

FROM node:20-alpine AS base
# Sem OpenSSL instalado, `prisma generate` não detecta nenhuma libssl
# disponível e cai no fallback "openssl-1.1.x" (avisado no log do build) —
# só que essa versão nem existe mais nos repositórios do Alpine desta
# imagem (`openssl1.1-compat` foi removido; só openssl 3.x é empacotado).
# Instalando openssl (3.x) ANTES do `prisma generate` corrige a detecção:
# o Prisma passa a gerar/carregar o engine linkado contra libssl.so.3, que
# de fato existe aqui — o binário 1.1.x baixado antes falhava só em
# runtime (`libssl.so.1.1: No such file or directory`), não no build.
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /repo

# ── deps: instala o monorepo inteiro, cacheável enquanto os manifests não mudam ──
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

# ── build: gera o Prisma Client e compila apps/api ──
FROM deps AS build
COPY . .
RUN pnpm --filter @opsmind/database exec prisma generate
RUN pnpm --filter @opsmind/api run build
# NOTA (otimização pendente, não bloqueante): a imagem final carrega
# node_modules com devDependencies do monorepo inteiro, não só as deps de
# produção — mais simples e testado de ponta a ponta agora. `turbo prune
# --docker` (poda por workspace, deps de produção só) é o próximo passo pra
# reduzir tamanho de imagem, deixado pra depois de propósito.

# ── runtime ──
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/
COPY --from=build /repo/apps/api/package.json /repo/apps/api/package.json
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/apps/api/node_modules /repo/apps/api/node_modules
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/apps/worker/package.json /repo/apps/worker/package.json
COPY --from=build /repo/apps/web/package.json /repo/apps/web/package.json

WORKDIR /repo/apps/api
EXPOSE 3000
# Sem usuário root em produção (checklist de segurança) — a imagem base
# node:alpine já vem com o usuário `node` (uid 1000) pronto pra isso.
USER node
CMD ["node_modules/.bin/tsx", "dist/main.js"]
