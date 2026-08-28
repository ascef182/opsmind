# syntax=docker/dockerfile:1

# Build de produção do apps/web — Next.js `output: 'standalone'` (next.config.js)
# já resolve o problema de workspace packages TS-fonte que apps/api/apps/worker
# precisam do `tsx` pra contornar: o file tracing do Next transpila e traça
# só os módulos de fato importados (incluindo @opsmind/shared-types, listado
# em `transpilePackages`), produzindo um server.js autocontido. Imagem final
# não carrega o node_modules do monorepo inteiro.

FROM node:20-alpine AS base
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
# NEXT_PUBLIC_* é inlinado em build time (não runtime) — precisa estar
# disponível já aqui, via --build-arg no `docker build`.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm --filter @opsmind/web run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/public /repo/apps/web/public
COPY --from=build /repo/apps/web/.next/standalone /repo
COPY --from=build /repo/apps/web/.next/static /repo/apps/web/.next/static

WORKDIR /repo/apps/web
EXPOSE 3001
USER node
CMD ["node", "server.js"]
