# OpsMind

**AI-Powered Business Operations Platform** — CRM, tarefas, documentos e automações, com uma camada de IA que lê o contexto real do negócio e age sobre ele.

> Your business data shouldn't just be stored. It should work for you.

## Estado do projeto

Fase 1 (Foundation) em andamento. Veja:

- [`docs/planning/PRD.md`](docs/planning/PRD.md) — PRD + arquitetura técnica completa.
- [`docs/planning/sprint-1-2-plan.md`](docs/planning/sprint-1-2-plan.md) — síntese da rodada de planejamento (7 agentes especializados revisaram o PRD) e plano de execução da Fase 1.
- [`docs/planning/reviews/`](docs/planning/reviews/) — pareceres completos de cada especialista (arquitetura, banco de dados, segurança, RAG, evals de IA).

Em desenvolvimento na branch `feat/leads-prospecting`: geração de pipeline de vendas — busca de negócios
locais por cidade/estado/tipo (priorizando quem não tem site) via fontes plugáveis (Apify, Explorium,
camofox-browser), qualificação automática, e um Dashboard redesenhado com visual dark-mode. Plano completo em
[`docs/superpowers/plans/2026-09-02-leads-prospecting-dashboard.md`](docs/superpowers/plans/2026-09-02-leads-prospecting-dashboard.md).

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
  web/                Next.js
  api/                NestJS
  worker/             BullMQ (automações, scrape jobs)
packages/
  database/           Prisma schema + client
  shared-types/       DTOs/tipos compartilhados
  config/             eslint, tsconfig, env schema
  integrations/       gateways externos (Apify, Explorium, camofox-browser) — em desenvolvimento
infra/
  docker/             docker-compose local
  terraform/          IaC (Fase 6)
```
