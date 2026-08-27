# Blueprint de Implementação — Fase 1 (Foundation)

**Agente:** code-architect
**Escopo:** PRD OpsMind §9, §10.2, §15, §16, §17-Fase 1 (Sprints 1–2)
**Critério de aceitação alvo (PRD §17):** *"um usuário consegue criar uma organização, convidar outro usuário com um papel específico, e uma ação sensível gera um registro de auditoria."*
**Natureza do documento:** este é um blueprint de análise/planejamento. Nenhum arquivo de código do projeto foi criado ou modificado — apenas este review.

> Nota de contexto: o repositório está vazio (greenfield). Não há padrões de código pré-existentes para mapear, então este blueprint é derivado diretamente das decisões de stack e modelo de dados do PRD, seguindo as convenções que o próprio PRD já estabelece (§10.2, §16).

---

## Architecture: Fase 1 — Foundation (Monorepo, Auth, Organizations, RBAC, Audit)

### Design Decisions

| # | Decisão | Racional |
|---|---|---|
| 1 | **pnpm workspaces + Turborepo** para o monorepo | Padrão de mercado para monorepos TS (Next.js + NestJS + packages compartilhados); Turborepo dá cache de build/lint/test entre `apps/*` e `packages/*` sem exigir infra extra — barato de adotar já no Sprint 1, caro de retrofitar depois. |
| 2 | **`packages/database` como fonte única do schema Prisma** | `apps/api` e (futuramente) workers consomem o mesmo `PrismaClient` gerado; evita schema duplicado e migrations divergentes. |
| 3 | **IDs como UUID (`@default(uuid())`)**, tabelas em `snake_case` via `@@map`/`@map` | O PRD §9 já descreve os campos em `snake_case` (`password_hash`, `ai_monthly_budget`); Prisma mantém os models em camelCase no código e mapeia para `snake_case` no banco — convenção padrão Prisma, sem custo extra. |
| 4 | **Access token JWT (15 min) sem `organizationId`/`role` embutidos** + resolução de tenant/role **por request** via `TenantGuard` consultando `Membership` no banco | O PRD §8 exige que troca de organização seja explícita e que role changes/remoções tenham efeito imediato. Se o role fosse embutido no JWT, uma remoção de membro só teria efeito depois do token expirar (falha de segurança). Custo: uma query extra por request — aceitável no MVP, cacheável em Redis mais tarde sem mudar o contrato do guard. |
| 5 | **Refresh token com rotação, armazenado como hash em tabela `RefreshToken`** (não em Redis) | Sprint 1-2 não introduz Redis/BullMQ (isso só chega na Fase 5). Persistir em Postgres evita subir Redis cedo só para isso e mantém tudo auditável/consultável via Prisma. |
| 6 | **Hash de senha com Argon2id** (`argon2` npm package) | PRD §14 permite bcrypt ou argon2; argon2id é a recomendação atual (OWASP) e o pacote Node é maduro. |
| 7 | **Auditoria via chamadas explícitas a `AuditService.log()`** dentro de cada service sensível, não um interceptor genérico | Seguindo o princípio de não introduzir abstração especulativa: mapear rota→ação de forma genérica exigiria uma convenção ainda inexistente. Chamada explícita é mais simples de revisar e garante que o `metadata` do log é preciso. Um interceptor pode ser extraído depois, quando o padrão de "o que audita" estiver estável (mais módulos implementados). |
| 8 | **`AuditLog.organizationId` nullable** (diferença deliberada do PRD §9, que lista o campo sem indicar nulidade) | `user.registered` acontece antes de qualquer organização existir. Tornar o campo opcional é a única forma de auditar o registro de conta sem inventar uma organização fictícia. Documentado aqui como desvio intencional. |
| 9 | **`Invitation` e `RefreshToken` como entidades novas, não listadas no PRD §9** | São pré-requisitos técnicos diretos dos requisitos funcionais da própria Fase 1 ("Auth ... refresh", "convidar outro usuário"). O PRD §9 é uma lista de "entidades principais", não exaustiva — adicionar essas duas é a extensão mínima necessária, sem especular sobre entidades de fases futuras. |
| 10 | **`EmailVerificationToken` incluído; `PasswordResetToken` adiado** | PRD §6 lista "verificação de e-mail" como parte do MVP de auth, e o fluxo de registro fica incompleto sem ela. Reset de senha (§14) não está no escopo explícito de Sprints 1-2 — fica marcado como próxima extensão natural do mesmo padrão (reaproveita `TokenService`). |
| 11 | **`RolesGuard` com hierarquia linear** `OWNER > ADMIN > MANAGER > MEMBER > VIEWER` | O PRD não define permissões granulares por papel na Fase 1 — só exige que RBAC básico exista. Uma hierarquia linear (nível N pode tudo que N+1 pode) é suficiente para os 4 endpoints da Fase 1 e não faz suposições sobre permissões futuras do CRM/Tasks. |
| 12 | **Nenhum repository layer entre Service e `PrismaService`** | Prisma já é uma camada de acesso a dados type-safe; um repository adicional seria abstração especulativa sem consumidor hoje (não há segundo banco/ORM cogitado). Services injetam `PrismaService` diretamente. |
| 13 | **`@nestjs/throttler` aplicado a `/auth/*` desde o Sprint 1** | Login/registro são os endpoints mais expostos a brute-force e já existem na Fase 1; rate limiting geral (PRD §14/§17-Fase 6) fica para depois, mas proteger auth é barato e diretamente relevante ao que está sendo construído agora. |
| 14 | **`apps/web` recebe apenas o esqueleto do workspace (Next.js + tsconfig compartilhado), sem UI de auth** | O critério de aceitação da Fase 1 é validável inteiramente via API (curl/Postman/e2e tests). Construir UI de login/registro agora antecipa trabalho da Fase 2 sem necessidade; mas *não* criar o workspace do `apps/web` agora forçaria reconfigurar o monorepo depois — por isso o esqueleto entra já, vazio. |

---

### Estrutura do Monorepo

```
opsmind/
├── package.json                      # workspaces: ["apps/*", "packages/*"]
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
├── .env.example
├── .gitignore
├── .nvmrc                            # node 20 LTS
├── README.md
│
├── apps/
│   ├── api/                          # NestJS
│   │   ├── package.json
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   ├── test/
│   │   │   ├── jest-e2e.json
│   │   │   ├── auth.e2e-spec.ts
│   │   │   └── organizations-flow.e2e-spec.ts
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── app.controller.ts     # GET /health
│   │       ├── modules/
│   │       │   ├── auth/
│   │       │   │   ├── auth.module.ts
│   │       │   │   ├── auth.controller.ts
│   │       │   │   ├── auth.service.ts
│   │       │   │   ├── strategies/
│   │       │   │   │   ├── jwt-access.strategy.ts
│   │       │   │   │   └── jwt-refresh.strategy.ts
│   │       │   │   ├── services/
│   │       │   │   │   ├── password.service.ts
│   │       │   │   │   └── token.service.ts
│   │       │   │   └── dto/
│   │       │   │       ├── register.dto.ts
│   │       │   │       ├── login.dto.ts
│   │       │   │       └── refresh-token.dto.ts
│   │       │   ├── users/
│   │       │   │   ├── users.module.ts
│   │       │   │   └── users.service.ts
│   │       │   ├── organizations/
│   │       │   │   ├── organizations.module.ts
│   │       │   │   ├── organizations.controller.ts
│   │       │   │   ├── organizations.service.ts
│   │       │   │   └── dto/
│   │       │   │       └── create-organization.dto.ts
│   │       │   ├── memberships/
│   │       │   │   ├── memberships.module.ts
│   │       │   │   ├── memberships.controller.ts
│   │       │   │   ├── memberships.service.ts
│   │       │   │   ├── invitations.service.ts
│   │       │   │   └── dto/
│   │       │   │       ├── invite-member.dto.ts
│   │       │   │       ├── update-member-role.dto.ts
│   │       │   │       └── accept-invitation.dto.ts
│   │       │   └── audit/
│   │       │       ├── audit.module.ts
│   │       │       ├── audit.controller.ts
│   │       │       └── audit.service.ts
│   │       ├── infrastructure/
│   │       │   ├── database/
│   │       │   │   ├── prisma.module.ts    # @Global()
│   │       │   │   └── prisma.service.ts
│   │       │   └── email/
│   │       │       ├── email.module.ts
│   │       │       ├── email.service.ts        # interface + token de DI
│   │       │       └── console-email.provider.ts  # implementação dev (log no console)
│   │       └── shared/
│   │           ├── guards/
│   │           │   ├── jwt-auth.guard.ts
│   │           │   ├── tenant.guard.ts
│   │           │   └── roles.guard.ts
│   │           ├── decorators/
│   │           │   ├── public.decorator.ts
│   │           │   ├── current-user.decorator.ts
│   │           │   ├── current-membership.decorator.ts
│   │           │   └── roles.decorator.ts
│   │           ├── constants/
│   │           │   └── roles.constant.ts       # ordem de hierarquia dos 5 papéis
│   │           └── pipes/
│   │               └── (ValidationPipe global registrado no main.ts; sem pipes customizados na Fase 1)
│   │
│   └── web/                          # Next.js — esqueleto apenas
│       ├── package.json
│       ├── next.config.js
│       ├── tsconfig.json
│       └── app/
│           ├── layout.tsx
│           └── page.tsx              # placeholder, sem lógica de auth ainda
│
├── packages/
│   ├── database/
│   │   ├── package.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── seed.ts               # cria 1 org + 1 owner para dev local
│   │   │   └── migrations/           # geradas por `prisma migrate dev`
│   │   └── src/
│   │       └── index.ts              # re-exporta PrismaClient + tipos gerados
│   │
│   ├── shared-types/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── auth.types.ts         # RegisterInput, LoginInput, AuthTokens
│   │       ├── organization.types.ts
│   │       ├── membership.types.ts   # Role, MembershipDto
│   │       └── audit.types.ts
│   │
│   └── config/
│       ├── package.json
│       ├── eslint/base.js
│       ├── typescript/
│       │   ├── base.json
│       │   ├── nestjs.json
│       │   └── nextjs.json
│       └── env/
│           └── schema.ts             # validação Zod de env vars (DATABASE_URL, JWT_SECRET, ...)
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml        # postgres (pgvector/pgvector image) + redis
│   │   └── api.Dockerfile            # usado só na Fase 6, mas pode existir vazio/stub
│   └── terraform/                    # vazio — Fase 6
│
└── .github/
    └── workflows/
        └── ci.yml                    # lint + typecheck + test + prisma validate (opcional na Fase 1)
```

---

### Schema Prisma inicial (`packages/database/prisma/schema.prisma`)

Cobre exatamente as entidades do PRD §9 necessárias à Fase 1 (`Organization`, `User`, `Membership`, `AuditLog`) mais as duas extensões de suporte justificadas na Decisão #9/#10 (`Invitation`, `RefreshToken`, `EmailVerificationToken`). `Customer`, `Task`, `Document`, `DocumentChunk`, `Automation*`, `AIRequest`, `Notification` ficam **fora** deste schema — entram nas fases correspondentes (§17).

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Enums ────────────────────────────────────────────────

enum Role {
  OWNER
  ADMIN
  MANAGER
  MEMBER
  VIEWER
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
  REVOKED
}

enum AuditActorType {
  USER
  AI
  SYSTEM
  AUTOMATION
}

// ── Core tenancy ─────────────────────────────────────────

model Organization {
  id              String    @id @default(uuid())
  name            String
  slug            String    @unique
  plan            String    @default("free")
  aiMonthlyBudget Decimal?  @map("ai_monthly_budget") @db.Decimal(10, 2)
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  memberships Membership[]
  invitations Invitation[]
  auditLogs   AuditLog[]

  @@map("organizations")
}

model User {
  id              String    @id @default(uuid())
  email           String    @unique
  passwordHash    String    @map("password_hash")
  name            String
  emailVerifiedAt DateTime? @map("email_verified_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  memberships           Membership[]
  refreshTokens         RefreshToken[]
  emailVerificationTokens EmailVerificationToken[]
  sentInvitations       Invitation[]              @relation("InvitedBy")

  @@map("users")
}

model Membership {
  id             String   @id @default(uuid())
  userId         String   @map("user_id")
  organizationId String   @map("organization_id")
  role           Role
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
  @@index([organizationId])
  @@map("memberships")
}

// ── Auth support ─────────────────────────────────────────

model RefreshToken {
  id                 String    @id @default(uuid())
  userId             String    @map("user_id")
  tokenHash          String    @unique @map("token_hash")
  expiresAt          DateTime  @map("expires_at")
  revokedAt          DateTime? @map("revoked_at")
  replacedByTokenId  String?   @map("replaced_by_token_id")
  createdByIp        String?   @map("created_by_ip")
  createdAt          DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("refresh_tokens")
}

model EmailVerificationToken {
  id         String    @id @default(uuid())
  userId     String    @map("user_id")
  tokenHash  String    @unique @map("token_hash")
  expiresAt  DateTime  @map("expires_at")
  consumedAt DateTime? @map("consumed_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("email_verification_tokens")
}

// ── Invitations (org membership onboarding) ─────────────

model Invitation {
  id              String           @id @default(uuid())
  organizationId  String           @map("organization_id")
  email           String
  role            Role
  tokenHash       String           @unique @map("token_hash")
  status          InvitationStatus @default(PENDING)
  invitedByUserId String           @map("invited_by_user_id")
  expiresAt       DateTime         @map("expires_at") // criado com now()+7d (regra §8)
  acceptedAt      DateTime?        @map("accepted_at")
  createdAt       DateTime         @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invitedBy    User          @relation("InvitedBy", fields: [invitedByUserId], references: [id])

  @@index([organizationId])
  @@index([email])
  @@map("invitations")
}

// ── Audit (append-only) ──────────────────────────────────

model AuditLog {
  id             String          @id @default(uuid())
  organizationId String?         @map("organization_id") // nullable: eventos pré-organização (ex.: user.registered)
  actorType      AuditActorType  @map("actor_type")
  actorId        String?         @map("actor_id")         // não é FK: ator pode ser AI/system/automation
  action         String          // ex.: "user.registered", "membership.invited"
  resource       String          // ex.: "User:<id>", "Membership:<id>"
  metadata       Json?
  ipAddress      String?         @map("ip_address")
  userAgent      String?         @map("user_agent")
  createdAt      DateTime        @default(now()) @map("created_at")

  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)

  @@index([organizationId, createdAt])
  @@index([action])
  @@map("audit_logs")
}
```

**Notas de implementação do schema:**
- `AuditLog` não tem `onUpdate`/soft-delete — é intencionalmente append-only e imutável (a regra do PRD §8 sobre soft-delete se aplica a Customer/Document, fases futuras, não a este log).
- `Invitation.tokenHash` e `RefreshToken.tokenHash`/`EmailVerificationToken.tokenHash` armazenam **hash** do token (SHA-256), nunca o valor bruto — o valor bruto só existe no e-mail enviado e na URL, nunca no banco.
- pgvector **não** entra neste schema (só é necessário a partir da Fase 4 com `Document`/`DocumentChunk`); adicionar a extensão agora seria antecipar infraestrutura sem uso.

---

### Módulos NestJS — Arquivos a Criar (por ordem de dependência)

#### Passo 0 — Monorepo & infraestrutura local

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json` | Definição do monorepo | P0 |
| `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc` | Config compartilhada (via `packages/config` posteriormente) | P0 |
| `packages/config/env/schema.ts` | Schema Zod de env vars (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PORT`, ...) | P0 |
| `infra/docker/docker-compose.yml` | Postgres (`pgvector/pgvector:pg16`) + Redis (não usado ainda, mas evita retrofit na Fase 5) | P0 |
| `.env.example` | Template de variáveis | P0 |

**Marco testável:** `docker compose up -d` sobe Postgres saudável.

#### Passo 1 — `packages/database`

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `packages/database/prisma/schema.prisma` | Schema acima | P0 |
| `packages/database/src/index.ts` | Re-exporta `PrismaClient` + tipos gerados para consumo por `apps/api` | P0 |
| `packages/database/prisma/seed.ts` | Cria org + owner de exemplo para dev local | P1 |

**Marco testável:** `pnpm --filter database prisma migrate dev` cria as tabelas; `prisma studio` mostra o schema.

#### Passo 2 — Bootstrap do `apps/api`

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `apps/api/src/main.ts` | Bootstrap Nest, `ValidationPipe` global, `ThrottlerGuard` global, CORS | P0 |
| `apps/api/src/app.module.ts` | Módulo raiz, importa `PrismaModule`, `ThrottlerModule`, módulos de domínio | P0 |
| `apps/api/src/infrastructure/database/prisma.service.ts` | Extends `PrismaClient`, implementa `OnModuleInit`/`OnModuleDestroy` | P0 |
| `apps/api/src/infrastructure/database/prisma.module.ts` | `@Global()` module exportando `PrismaService` | P0 |
| `apps/api/src/app.controller.ts` | `GET /health` — checa conexão com o banco | P0 |

**Marco testável:** `pnpm --filter api start:dev` + `curl localhost:3000/health` → `200 OK`. Este é o primeiro ponto em que a stack inteira (Docker → Prisma → Nest) está provada de ponta a ponta.

#### Passo 3 — `shared/` (guards e decorators-base, sem lógica de auth ainda)

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `shared/decorators/public.decorator.ts` | Marca rota como pública (bypassa `JwtAuthGuard`) | P0 |
| `shared/constants/roles.constant.ts` | `export const ROLE_HIERARCHY: Role[] = [OWNER, ADMIN, MANAGER, MEMBER, VIEWER]` | P0 |
| `shared/decorators/roles.decorator.ts` | `@Roles(Role.ADMIN)` — grava metadata para `RolesGuard` | P0 |

*(`jwt-auth.guard.ts`, `tenant.guard.ts`, `roles.guard.ts` entram no Passo 5, depois que `auth`/`memberships` existirem, pois dependem de `TokenService`/`Membership`.)*

#### Passo 4 — `modules/users` (mínimo, consumido por `auth`)

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `modules/users/users.module.ts` | Exporta `UsersService` | P0 |
| `modules/users/users.service.ts` | `findByEmail`, `create`, `markEmailVerified` — usa `PrismaService` diretamente | P0 |

#### Passo 5 — `modules/auth`

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `modules/auth/dto/register.dto.ts` | `{ email, password, name }` com `class-validator` | P0 |
| `modules/auth/dto/login.dto.ts` | `{ email, password }` | P0 |
| `modules/auth/dto/refresh-token.dto.ts` | `{ refreshToken }` | P0 |
| `modules/auth/services/password.service.ts` | `hash(plain)`, `verify(plain, hash)` via argon2 | P0 |
| `modules/auth/services/token.service.ts` | `signAccessToken(userId)`, `issueRefreshToken(userId, ip)`, `rotateRefreshToken(oldToken)`, `revokeRefreshToken(token)` | P0 |
| `modules/auth/strategies/jwt-access.strategy.ts` | Passport strategy, valida access token, popula `req.user = { id, email }` | P0 |
| `modules/auth/auth.service.ts` | `register()`, `login()`, `refresh()`, `logout()` — chama `AuditService.log()` em cada operação sensível | P0 |
| `modules/auth/auth.controller.ts` | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` | P0 |
| `shared/guards/jwt-auth.guard.ts` | Guard global (registrado via `APP_GUARD`), respeita `@Public()` | P0 |
| `modules/auth/auth.module.ts` | Liga tudo acima; `JwtModule.registerAsync` com secrets do env schema | P0 |
| `shared/decorators/current-user.decorator.ts` | `@CurrentUser()` — extrai `req.user` | P0 |

**Marco testável:** fluxo completo via curl/Postman — registrar, logar, receber access+refresh token, chamar rota protegida, dar refresh, dar logout (refresh token revogado).

#### Passo 6 — `modules/audit`

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `modules/audit/audit.service.ts` | `log({ organizationId?, actorType, actorId?, action, resource, metadata?, ipAddress?, userAgent? })` — grava via `PrismaService` | P0 |
| `modules/audit/audit.module.ts` | `@Global()` ou exportado explicitamente para os demais módulos de domínio | P0 |
| `modules/audit/audit.controller.ts` | `GET /audit-logs` (protegido por `@Roles(Role.ADMIN)` + `TenantGuard`) | P1 |

**Ação:** voltar ao `auth.service.ts` do Passo 5 e inserir as chamadas `auditService.log(...)` em `register()` e `login()`.

**Marco testável:** após `POST /auth/register`, existe uma linha em `audit_logs` com `action: "user.registered"`.

#### Passo 7 — `modules/organizations`

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `modules/organizations/dto/create-organization.dto.ts` | `{ name, slug? }` (slug auto-gerado do name se omitido) | P0 |
| `modules/organizations/organizations.service.ts` | `create(userId, dto)` — transação: cria `Organization` + `Membership{role: OWNER}`; `findById`, `listForUser` | P0 |
| `modules/organizations/organizations.controller.ts` | `POST /organizations`, `GET /organizations/:id` | P0 |
| `modules/organizations/organizations.module.ts` | Liga service/controller, importa `AuditModule` | P0 |

**Ação:** `create()` chama `auditService.log({ action: "organization.created", actorType: USER, actorId: userId, organizationId: org.id, ... })`.

**Marco testável:** usuário autenticado cria uma org e vira `OWNER`.

#### Passo 8 — Guards que dependem de `Membership` (`tenant.guard.ts`, `roles.guard.ts`)

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `shared/guards/tenant.guard.ts` | Lê `organizationId` de `req.params` (rotas `/organizations/:organizationId/...`), busca `Membership` do `req.user.id`, anexa `req.membership`; 403 se não houver vínculo | P0 |
| `shared/guards/roles.guard.ts` | Lê metadata de `@Roles(...)`, compara `req.membership.role` contra `ROLE_HIERARCHY` | P0 |
| `shared/decorators/current-membership.decorator.ts` | `@CurrentMembership()` — extrai `req.membership` | P0 |

#### Passo 9 — `modules/memberships` (invite / accept / role management)

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `modules/memberships/dto/invite-member.dto.ts` | `{ email, role }` | P0 |
| `modules/memberships/dto/accept-invitation.dto.ts` | `{ token }` | P0 |
| `modules/memberships/dto/update-member-role.dto.ts` | `{ role }` | P1 |
| `modules/memberships/invitations.service.ts` | `create(orgId, invitedByUserId, dto)` (expira em 7 dias, regra §8), `accept(userId, token)`, `revoke(id)` | P0 |
| `modules/memberships/memberships.service.ts` | `listForOrganization`, `updateRole`, `remove` | P1 |
| `modules/memberships/memberships.controller.ts` | `POST /organizations/:organizationId/invite`, `POST /invitations/:token/accept`, `GET /organizations/:organizationId/members`, `PATCH /organizations/:organizationId/members/:userId`, `DELETE /organizations/:organizationId/members/:userId` | P0/P1 |
| `modules/memberships/memberships.module.ts` | Liga tudo, aplica `TenantGuard` + `RolesGuard` (`@Roles(Role.ADMIN)` no invite/update/remove) | P0 |

**Ação:** `invitations.service.ts` chama `auditService.log({ action: "membership.invited", ... })` no convite e `"membership.accepted"` no accept; `memberships.service.ts` chama `"membership.role_updated"` / `"membership.removed"`.

**Marco testável — fecha o critério de aceitação da Fase 1 por completo:** usuário A cria org → convida usuário B com role `MEMBER` → B aceita o convite → `GET /organizations/:id/members` mostra os dois → `GET /audit-logs` mostra `organization.created`, `membership.invited`, `membership.accepted`.

#### Passo 10 — Infra de e-mail (necessária para o convite ser usável)

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `infrastructure/email/email.service.ts` | Interface `sendInvitationEmail()`, `sendVerificationEmail()` | P0 |
| `infrastructure/email/console-email.provider.ts` | Implementação dev: loga o link no console/log estruturado em vez de enviar de verdade | P0 |
| `infrastructure/email/email.module.ts` | Provider token + DI | P0 |

*(Um provider real — Resend ou similar — é uma troca de implementação isolada nesta interface; não é bloqueante para a Fase 1 nem para os testes e2e.)*

#### Passo 11 — Testes

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `apps/api/test/auth.e2e-spec.ts` | register → login → rota protegida → refresh → logout | P0 |
| `apps/api/test/organizations-flow.e2e-spec.ts` | Fluxo completo do critério de aceitação (org → invite → accept → audit log) | P0 |
| Unit tests por service (`auth.service.spec.ts`, `organizations.service.spec.ts`, `invitations.service.spec.ts`, `token.service.spec.ts`) | Regras de negócio isoladas (expiração de convite, rotação de refresh token, hierarquia de roles) | P1 |

#### Passo 12 — CI e `apps/web` (opcionais nesta fase, mas baratos de deixar prontos)

| Arquivo | Propósito | Prioridade |
|---|---|---|
| `.github/workflows/ci.yml` | `pnpm install && pnpm lint && pnpm typecheck && pnpm test && prisma validate` | P2 |
| `apps/web/app/layout.tsx`, `apps/web/app/page.tsx` | Esqueleto Next.js só para o workspace existir e o `packages/shared-types` ter um segundo consumidor real | P2 |

---

### Data Flow (fluxo do critério de aceitação)

```
1. POST /auth/register          → AuthService.register()
                                     → UsersService.create() (Argon2 hash)
                                     → TokenService.signAccessToken() + issueRefreshToken()
                                     → AuditService.log(actorType=USER, action="user.registered", organizationId=null)

2. POST /auth/login              → AuthService.login() → tokens novos → audit "user.logged_in"

3. POST /organizations           → [JwtAuthGuard] → OrganizationsService.create()
                                     → tx: Organization.create + Membership.create(role=OWNER)
                                     → AuditService.log(action="organization.created", organizationId=org.id)

4. POST /organizations/:id/invite → [JwtAuthGuard → TenantGuard → RolesGuard(ADMIN+)]
                                     → InvitationsService.create() (expiresAt = now+7d)
                                     → EmailService.sendInvitationEmail()
                                     → AuditService.log(action="membership.invited")

5. POST /invitations/:token/accept → [JwtAuthGuard] (usuário convidado autenticado, e-mail deve bater)
                                     → InvitationsService.accept() → Membership.create(role=<do convite>)
                                     → AuditService.log(action="membership.accepted")

6. GET /audit-logs                → [JwtAuthGuard → TenantGuard → RolesGuard(ADMIN+)]
                                     → AuditService lista por organizationId, ordenado por createdAt desc
```

Isolamento de tenant: todo endpoint a partir do passo 3 passa por `TenantGuard`, que resolve `req.membership` a partir de `:organizationId` na URL + `Membership` no banco — nenhuma query de domínio roda sem esse filtro.

---

### Build Sequence (resumo)

1. **Tipos/infra base** — monorepo, `packages/config` (env schema Zod), Docker Compose.
2. **Schema/dados** — `packages/database` (Prisma schema acima) + migração inicial.
3. **Integração mínima provada** — bootstrap `apps/api`, `PrismaService`, `GET /health`.
4. **Core logic — identidade** — `users` → `auth` (register/login/refresh/logout) com `JwtAuthGuard`.
5. **Core logic — auditoria** — `audit` module, plugado em `auth`.
6. **Core logic — tenancy** — `organizations` (criação + membership OWNER automático).
7. **Guards de autorização** — `TenantGuard` + `RolesGuard` (dependem de `organizations`/`memberships` existirem).
8. **Core logic — colaboração** — `memberships`/`invitations` (invite, accept, list, update role, remove), com `EmailService` stub.
9. **Testes** — e2e cobrindo o critério de aceitação ponta a ponta; unit tests das regras de negócio (expiração de convite, rotação de refresh token).
10. **CI + esqueleto `apps/web`** — baixa prioridade nesta fase, mas evita retrabalho de configuração na Fase 2.

---

### Riscos e Decisões em Aberto

- **Verificação de e-mail bloqueante ou não:** o PRD lista verificação de e-mail como parte do MVP, mas não deixa claro se login é bloqueado até o e-mail ser confirmado. Recomendação: **não bloquear** no Sprint 1-2 (métrica de simplicidade > fricção), apenas registrar `emailVerifiedAt`; reforçar depois se virar requisito explícito de produto.
- **Convite para e-mail sem conta existente:** resolvido aqui como "aceitar exige sessão autenticada com e-mail batendo ao convite" (usuário se registra primeiro se necessário). Alternativa mais amigável (aceitar cria a conta no mesmo request) é possível, mas adiciona complexidade de senha/validação ao `InvitationsService` — vale revisitar com o PO antes da Fase 2 se a UX importar cedo.
- **Cache de `Membership` no `TenantGuard`:** aceito como query direta ao Postgres por request nesta fase; se latência virar problema real (não há evidência disso ainda), mover para Redis é uma troca isolada dentro do guard, sem mudar o contrato dos controllers.

### Fora de Escopo da Fase 1 (deferred, não construir agora)

- `Customer`, `Task`, `Document`, `DocumentChunk`, `Automation`, `AutomationRun`, `AIRequest`, `Notification` — entram nas Fases 2 a 7 conforme §17.
- Extensão `pgvector` no schema.
- BullMQ/workers — Redis sobe no Docker Compose desde já (Decisão #1), mas fica ocioso até a Fase 5.
- `PasswordResetToken` / fluxo de "esqueci minha senha".
- Rate limiting geral além de `/auth/*`.
- Provider de e-mail real (Resend/SendGrid) — interface pronta, implementação concreta é troca de 1 arquivo.
- UI de autenticação/organizações em `apps/web`.
