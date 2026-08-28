# syntax=docker/dockerfile:1

# Build de produção do apps/worker (Fase 5/6). Mesmo padrão de apps/api/Dockerfile
# — ver os comentários lá (monorepo inteiro instalado, sem `turbo prune`;
# roda via `tsx` porque packages/config/database/shared-types exportam .ts
# fonte direto). Testado localmente antes de considerar este arquivo pronto.

FROM node:20-alpine AS base
# Ver nota em apps/api/Dockerfile — o worker também usa @opsmind/database
# (Prisma), mesmo requisito de OpenSSL pro engine binário ser detectado e
# linkado corretamente (openssl 3.x, não o 1.1 legado que não existe mais
# nos repositórios do Alpine desta imagem).
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @opsmind/database exec prisma generate
RUN pnpm --filter @opsmind/worker run build
# Ver nota em apps/api/Dockerfile — mesma decisão aqui: imagem maior
# (node_modules com devDependencies do monorepo inteiro), simplicidade sobre
# tamanho por ora.

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/
COPY --from=build /repo/apps/worker/package.json /repo/apps/worker/package.json
COPY --from=build /repo/apps/worker/dist /repo/apps/worker/dist
COPY --from=build /repo/apps/worker/node_modules /repo/apps/worker/node_modules
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/apps/api/package.json /repo/apps/api/package.json
COPY --from=build /repo/apps/web/package.json /repo/apps/web/package.json

WORKDIR /repo/apps/worker
# Sem porta exposta — o worker não escuta HTTP, só consome a fila BullMQ.
USER node
CMD ["node_modules/.bin/tsx", "dist/main.js"]
