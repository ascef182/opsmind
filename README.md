# OpsMind

**AI-Powered Business Operations Platform** — CRM, tarefas, documentos e automações, com uma camada de IA que lê o contexto real do negócio e age sobre ele.

> Your business data shouldn't just be stored. It should work for you.

## Estado do projeto

Fase 1 (Foundation) em andamento. Veja:

- [`docs/planning/PRD.md`](docs/planning/PRD.md) — PRD + arquitetura técnica completa.
- [`docs/planning/sprint-1-2-plan.md`](docs/planning/sprint-1-2-plan.md) — síntese da rodada de planejamento (7 agentes especializados revisaram o PRD) e plano de execução da Fase 1.
- [`docs/planning/reviews/`](docs/planning/reviews/) — pareceres completos de cada especialista (arquitetura, banco de dados, segurança, RAG, evals de IA).

## Stack

Next.js (web) + NestJS (api) + PostgreSQL/Prisma + pgvector + Redis/BullMQ — monorepo pnpm + Turborepo. Detalhes completos no PRD, seção 15.

## Desenvolvimento local

```bash
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres + Redis
cp .env.example .env                                       # ajuste os segredos
pnpm db:migrate
pnpm dev
```

`GET http://localhost:3000/health` deve responder `200 OK` quando a API e o banco estiverem de pé.

## Estrutura

```
apps/
  web/              Next.js
  api/               NestJS
packages/
  database/          Prisma schema + client
  shared-types/       DTOs/tipos compartilhados
  config/             eslint, tsconfig, env schema
infra/
  docker/             docker-compose local
  terraform/          IaC (Fase 6)
```
