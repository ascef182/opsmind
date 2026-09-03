# Leads (prospecção de negócios locais) + redesign do Dashboard

Spec/arquitetura completa aprovada em plan mode: `/Users/pam/.claude/plans/users-pam-documents-opsmind-dark-mode-s-shimmering-brooks.md` (não leia o arquivo inteiro nas tasks abaixo — cada task já traz o que precisa; esse arquivo é a autoridade em caso de dúvida do controller, não dos implementers).

## Contexto

O OpsMind (CRM/ops SaaS de uma agência) ganha uma feature de geração de pipeline: buscar negócios locais por cidade/estado/tipo, priorizando quem **não tem site**, qualificar automaticamente o potencial, e apresentar isso num Dashboard redesenhado com linguagem visual dark-mode (referência: SaaS financeiro com cards escuros, acento âmbar, sparklines, donut/bar/line charts). A busca é **plugável e multi-fonte, escolhida pelo usuário por job**: Apify (Google Maps), Explorium (busca+enrichment B2B), e camofox-browser (navegador stealth self-hosted, repo real em https://github.com/jo-inc/camofox-browser — MIT, Docker, API REST confirmada) para cobertura ampla (Google/Yelp/Reddit).

Há um branch não mergeado, `feat/prospecting-outbound` (worktree em `../feat-prospecting-outbound` a partir da raiz do repo, branch `feat/prospecting-outbound`), com uma feature de prospecção parecida mas focada em Reddit (286/286 testes passando). Várias tasks abaixo dizem explicitamente "adaptar de" esse branch — vale a pena abrir esses arquivos como referência de padrão (não copiar campos Reddit-específicos).

## Global Constraints

Seguir exatamente os padrões já estabelecidos no `CLAUDE.md` da raiz do repo (leia-o no início de qualquer task de `apps/api`/`apps/worker`/`apps/web`):

- **Multi-tenant/RLS**: toda tabela nova tem `organization_id` + policy RLS (`ENABLE`/`FORCE ROW LEVEL SECURITY`, policy `tenant_isolation` com `organization_id = current_setting('app.current_org_id', true) OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL`). Nunca usar `DATABASE_URL` (role dona das tabelas) em código de runtime — sempre `DATABASE_URL_APP`.
- **Sem repository layer**: services chamam `PrismaService`/`PrismaClient` direto.
- **Módulo NestJS padrão**: `<domain>.module.ts`, controller com `@UseGuards(TenantGuard)` de classe, rota base `organizations/:organizationId/<domain>`, mutações com `@Roles(...WRITE_ROLES) @UseGuards(RolesGuard)`, `dto/*.dto.ts` com class-validator.
- **Toda mutação chama `AuditService.log({actorType, actorId, organizationId, action, resource, metadata})`.**
- **`apps/worker` nunca importa nada de `apps/api`** — lógica compartilhada vai em `packages/shared-types` (funções puras) ou num novo `packages/integrations` (gateways).
- **Env vars novas**: sempre opcionais/fail-late (mesmo padrão de `ANTHROPIC_API_KEY` — app não trava no boot, falha claro só no primeiro uso real), e sempre em 3 lugares: `.env.example`, `packages/config/env/schema.ts`, `turbo.json` (`globalEnv`).
- **Comentários**: em português, explicando o "porquê" não-óbvio (não o "o quê") — mesmo estilo do resto do repo. Identificadores de código em inglês.
- **Prettier**: `semi: true, singleQuote: true, trailingComma: 'all', printWidth: 100, tabWidth: 2` (já configurado, rodar `pnpm exec prettier --write` nos arquivos tocados se necessário, mas o lint já cobre).
- Rodar `pnpm lint && pnpm typecheck && pnpm test` nos workspaces afetados antes de cada commit; nunca deixar um teste existente quebrado.
- Commits: Conventional Commits com escopo, ex. `feat(leads): schema + migrations` — sem `Co-Authored-By` (isso é adicionado pelo controller no final, não pelos implementers).
- **Nunca** rodar `git push`, nunca mexer em branch/worktree fora do atual, nunca rodar comandos destrutivos (`git reset --hard`, `docker volume rm`, etc.) sem perguntar ao controller.

---

## Task 1: Schema Prisma + migrations (`packages/database`)

Adicionar ao `packages/database/prisma/schema.prisma`:

**Enums novos:**
```prisma
enum ScrapeSourceType { APIFY_GOOGLE_MAPS EXPLORIUM_BUSINESS_SEARCH CAMOFOX_GOOGLE_SEARCH CAMOFOX_REDDIT_SEARCH MANUAL }
enum ScrapeJobStatus  { QUEUED RUNNING COMPLETED FAILED CANCELLED }
enum LeadStatus        { DISCOVERED QUALIFIED DISQUALIFIED OUTREACH_DRAFTED OUTREACH_APPROVED CONTACTED REPLIED CONVERTED LOST }
enum OutreachChannel   { EMAIL PHONE WHATSAPP LINKEDIN_DM REDDIT_DM OTHER }
enum OutreachStatus    { DRAFT APPROVED REJECTED SENT REPLIED }
```

**Models novos** (usar `@map`/`@@map` snake_case como todo o resto do schema já faz — conferir um model existente como `Customer` para o estilo exato):

```prisma
model ServiceOffering {
  id               String   @id @default(uuid())
  organizationId   String
  name             String
  description      String?
  signals          String[] @default([])
  targetIndustries String[] @default([])
  minEmployees     Int?
  maxEmployees     Int?
  minRevenueUsd    Int?
  maxRevenueUsd    Int?
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  organization      Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  suggestedForLeads Lead[]            @relation("SuggestedOffering")
  outreachMessages  OutreachMessage[]

  @@unique([organizationId, name])
  @@index([organizationId])
}

model ScrapeJob {
  id                 String           @id @default(uuid())
  organizationId     String
  sourceType         ScrapeSourceType
  city               String
  state              String
  businessType       String
  onlyWithoutWebsite Boolean          @default(true)
  limit              Int              @default(50)
  status             ScrapeJobStatus  @default(QUEUED)
  leadsFound         Int              @default(0)
  errorMessage       String?
  actorType          AuditActorType
  actorId            String?
  startedAt          DateTime?
  finishedAt         DateTime?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  leads        Lead[]

  @@index([organizationId, status])
  @@index([organizationId, createdAt])
}

model Lead {
  id                  String           @id @default(uuid())
  organizationId      String
  scrapeJobId         String?
  sourceType          ScrapeSourceType @default(MANUAL)
  name                String
  address             String?
  city                String?
  state               String?
  phone               String?
  email               String?
  website             String?
  googleCategory      String?
  rating              Decimal?         @db.Decimal(2, 1)
  reviewCount         Int?
  placeId             String?
  rawContent          String?          @db.Text
  rawSnapshot         Json?
  status              LeadStatus       @default(DISCOVERED)
  score               Int?
  scoreBreakdown       Json?
  suggestedOfferingId String?
  convertedCustomerId String?
  actorType           AuditActorType
  actorId             String?
  discoveredAt        DateTime         @default(now())
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  organization      Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  scrapeJob         ScrapeJob?       @relation(fields: [scrapeJobId], references: [id], onDelete: SetNull)
  suggestedOffering ServiceOffering? @relation("SuggestedOffering", fields: [suggestedOfferingId], references: [id], onDelete: SetNull)
  convertedCustomer Customer?        @relation(fields: [convertedCustomerId], references: [id], onDelete: SetNull)
  enrichments       LeadEnrichment[]
  outreachMessages  OutreachMessage[]

  @@unique([organizationId, placeId])
  @@index([organizationId, status])
  @@index([organizationId, city, state])
  @@index([organizationId, discoveredAt])
  @@index([scrapeJobId])
  @@index([convertedCustomerId])
}

model LeadEnrichment {
  id             String         @id @default(uuid())
  organizationId String
  leadId         String
  type           String
  data           Json
  sourceUrl      String?
  actorType      AuditActorType
  actorId        String?
  createdAt      DateTime       @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  lead         Lead         @relation(fields: [leadId], references: [id], onDelete: Cascade)

  @@index([organizationId, leadId])
}

model OutreachMessage {
  id                String          @id @default(uuid())
  organizationId    String
  leadId            String
  serviceOfferingId String?
  channel           OutreachChannel
  subject           String?
  body              String          @db.Text
  evidenceQuotes    Json
  status            OutreachStatus  @default(DRAFT)
  generatedByModel  String?
  aiRequestId       String?
  approvedByUserId  String?
  approvedAt        DateTime?
  rejectedReason    String?
  sentAt            DateTime?
  repliedAt         DateTime?
  actorType         AuditActorType
  actorId           String?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  organization    Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  lead            Lead             @relation(fields: [leadId], references: [id], onDelete: Cascade)
  serviceOffering ServiceOffering? @relation(fields: [serviceOfferingId], references: [id], onDelete: SetNull)
  approvedBy      User?            @relation("OutreachApprovedBy", fields: [approvedByUserId], references: [id], onDelete: SetNull)

  @@index([organizationId, status])
  @@index([leadId])
}
```

Nota: `Lead.rawContent` (texto livre, usado pelo fallback de keyword-match do fonte Camoufox) foi adicionado além do que o resumo arquitetural original tinha — é necessário para o scoring textual funcionar em leads não-estruturados; inclua-o.

**Alterações em models existentes:**
- `Organization`: adicionar `scrapingMonthlyBudget Decimal? @db.Decimal(10, 2)` + relations `serviceOfferings ServiceOffering[]`, `scrapeJobs ScrapeJob[]`, `leads Lead[]`, `leadEnrichments LeadEnrichment[]`, `outreachMessages OutreachMessage[]`.
- `Customer`: adicionar relation reversa `originLeads Lead[]`.
- `User`: adicionar `approvedOutreachMessages OutreachMessage[] @relation("OutreachApprovedBy")`.

**Migrations**: criar DUAS migrations novas em `packages/database/prisma/migrations/` (use `pnpm --filter database migrate` para gerar+aplicar contra `DATABASE_URL` local — Postgres/Redis já devem estar de pé via `docker compose -f infra/docker/docker-compose.yml up -d`; se `migrate dev` recusar rodar não-interativamente, crie a pasta de migration manualmente com SQL escrito à mão e resolva com `prisma migrate resolve --applied <nome>`, mesmo fallback já documentado para a migration do pgvector):
1. Uma para `CREATE TYPE`/`CREATE TABLE`/a nova coluna de `Organization` — siga a sintaxe exata de `packages/database/prisma/migrations/20260827204228_prospecting/migration.sql` (branch antigo, leia como referência de sintaxe apenas).
2. Uma para RLS — siga a sintaxe exata de `packages/database/prisma/migrations/20260827164710_enable_row_level_security/migration.sql` (branch atual) para cada uma das 5 tabelas novas.

Depois de aplicar as migrations: `pnpm --filter database exec prisma generate`.

**Verificação**: `pnpm --filter database exec prisma validate`, migrations aplicam sem erro contra o Postgres local, `pnpm typecheck` do monorepo inteiro continua limpo (o client gerado precisa compilar em `apps/api`/`apps/worker`, mesmo que nada os use ainda).

---

## Task 2: `packages/shared-types` (tipos + scoring puro) e env vars

**Depende da Task 1 estar mergeada** (precisa dos nomes de enum/campos exatos).

1. `packages/shared-types/src/lead-scraping.types.ts` (novo arquivo):
```ts
export const LEAD_SCRAPE_QUEUE = 'lead-scrape';
export interface LeadScrapeJobData {
  organizationId: string;
  scrapeJobId: string;
  actorType: AuditActorType; // importar de @prisma/client via @opsmind/database, mesmo padrão de automation.types.ts
  actorId?: string;
}
```
Siga o estilo exato de `packages/shared-types/src/automation.types.ts` (comentário explicando por que o payload é mínimo — o worker recarrega os parâmetros de busca do próprio banco, nunca confia em parâmetro "velho" da fila).

2. `packages/shared-types/src/lead-scoring.ts` (novo arquivo) — função **pura**, sem dependência de framework nenhuma:
```ts
export const QUALIFICATION_THRESHOLD = 50;

export interface LeadScoringInput {
  website: string | null;
  googleCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  rawContent: string | null; // usado só no fallback de keyword-match
  firmographics?: { industry?: string | null; employeeCount?: number | null; revenueUsd?: number | null } | null;
}

export interface ServiceOfferingIcp {
  id: string;
  signals: string[];
  targetIndustries: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  minRevenueUsd: number | null;
  maxRevenueUsd: number | null;
}

export interface LeadScoreBreakdown {
  hasNoWebsitePoints: number;
  icpFitPoints: number;
  activityPoints: number;
  keywordMatchPoints: number;
  total: number; // clamped 0-100
  matchedOfferingId: string | null;
  matchedSignals: string[]; // trechos que bateram, para exibir "por que esse score" na UI
}

export function scoreLead(input: LeadScoringInput, offerings: ServiceOfferingIcp[]): LeadScoreBreakdown;
```
Fórmula (documentar no código): `hasNoWebsitePoints` = 50 se `website` é null/vazio, senão 0 (sinal central do ICP — negócio sem site é o alvo). `icpFitPoints` até 30 — quando `firmographics` existe: 10 pts se `googleCategory` ou `firmographics.industry` bate (case-insensitive substring) com algum `targetIndustries` de alguma offering ativa, 10 pts se `firmographics.employeeCount` cai dentro de `[minEmployees,maxEmployees]` de alguma offering, 10 pts se `firmographics.revenueUsd` cai dentro de `[minRevenueUsd,maxRevenueUsd]`. `activityPoints` até 20 — `reviewCount > 0` → 10, `rating >= 4.0` → 10. `keywordMatchPoints` — SÓ quando não há `firmographics` (fonte não-estruturada tipo Camoufox): substring case-insensitive de cada `signals[]` de cada offering ativa contra `rawContent`; pontuação = `round(nºSignalsBatidos / totalSignalsDaOfferingVencedora * 60)` (a offering com mais matches vence, empate = primeira). `total` = soma dos pontos aplicáveis, clamped 0-100. `matchedOfferingId` = a offering vencedora (via ICP fit OU keyword match, o que tiver rodado). `status` de qualificação (calculado por quem chama esta função, não por ela): `total >= QUALIFICATION_THRESHOLD ? 'QUALIFIED' : 'DISQUALIFIED'`.

Escreva testes unitários (`lead-scoring.spec.ts`) cobrindo: negócio sem site + firmographics batendo tudo (score alto), negócio com site (hasNoWebsitePoints=0), lead sem firmographics mas com rawContent batendo signals (fallback ativado), nenhuma offering ativa (score só de hasNoWebsite+activity), múltiplas offerings (escolhe a de mais matches).

3. Env vars — adicionar em exatamente 3 lugares, todas opcionais (padrão `ANTHROPIC_API_KEY`):
   - `packages/config/env/schema.ts`: `APIFY_API_TOKEN: z.string().optional()`, `APIFY_GOOGLE_MAPS_ACTOR_ID: z.string().default('compass/google-maps-extractor')`, `EXPLORIUM_API_KEY: z.string().optional()`, `CAMOFOX_API_URL: z.string().url().optional()`, `CAMOFOX_ACCESS_KEY: z.string().optional()`. Adicionar comentário no mesmo estilo dos já existentes (por que é opcional, o que falha e quando).
   - `.env.example`: nova seção `# ── Leads (Apify + Explorium + Camoufox) ──` com o mesmo estilo de comentário das seções de IA/Documentos.
   - `turbo.json`: adicionar as 5 chaves no array `globalEnv`.

**Verificação**: `pnpm --filter shared-types typecheck` (ou o typecheck do monorepo), `pnpm --filter shared-types test` roda o novo spec, `pnpm typecheck` do monorepo continua limpo.

---

## Task 3: Novo pacote `packages/integrations` (gateways Apify/Explorium/Camofox) + serviço Docker

**Depende da Task 2** (usa os tipos de `packages/shared-types`, mas é majoritariamente independente do schema).

Criar `packages/integrations/` como novo workspace (`package.json` com `name: "@opsmind/integrations"`, `main`/`types` apontando pra `src/index.ts`, `private: true`, versão `0.0.0` — mesmo formato de `packages/shared-types/package.json`). Adicionar a dependência `apify-client` (versão estável mais recente do npm). Adicionar `@opsmind/integrations` como dependência `workspace:*` em `apps/api/package.json` e `apps/worker/package.json`.

Três gateways, cada um: uma interface, um token `Symbol` de DI (mesma convenção de `AI_GATEWAY`/`EMBEDDING_GATEWAY` já existente — `APIFY_GATEWAY`, `EXPLORIUM_GATEWAY`, `CAMOFOX_GATEWAY`; o token só é usado pelo `apps/api` via DI do Nest, `apps/worker` nunca usa o token, só instancia a classe direto), uma classe simples `new`-ável sem DI do Nest (construtor recebe só os valores primitivos de config, não `ConfigService`):

**`src/apify-gateway.ts`**:
```ts
export interface ApifySearchParams { city: string; state: string; businessType: string; limit: number }
export interface ApifyBusinessResult {
  name: string; address: string | null; city: string | null; state: string | null;
  phone: string | null; website: string | null; googleCategory: string | null;
  rating: number | null; reviewCount: number | null; placeId: string | null;
  raw: Record<string, unknown>;
}
export interface ApifyGateway { searchBusinesses(params: ApifySearchParams): Promise<ApifyBusinessResult[]> }
export class ApifyGatewayService implements ApifyGateway {
  constructor(private readonly apiToken: string, private readonly actorId: string) {}
  async searchBusinesses(params: ApifySearchParams): Promise<ApifyBusinessResult[]> { /* ApifyClient({token}).actor(actorId).call({...}) → dataset.listItems() → map via mapApifyItemToLead */ }
}
export function mapApifyItemToLead(item: Record<string, unknown>): ApifyBusinessResult { /* isolado — trocar de actor no futuro só toca esta função */ }
```
Campos assumidos do actor `compass/google-maps-extractor` (documentar com comentário "assumido, confirmar contra execução real antes de confiar cegamente" — mesmo espírito autocrítico do `CamofoxScrapingClient` do branch antigo): `title`→name, `address`→address, `city`, `state`, `phoneUnformatted`→phone, `website`, `categoryName`→googleCategory, `totalScore`→rating, `reviewsCount`→reviewCount, `placeId`. Trate qualquer campo ausente como `null`, nunca lance erro por campo faltando.

**`src/explorium-gateway.ts`**:
```ts
export interface ExploriumSearchParams { city: string; state: string; businessType: string; onlyWithoutWebsite: boolean; limit: number }
export interface ExploriumBusinessResult {
  name: string; website: string | null; industry: string | null;
  employeeCount: number | null; revenueUsd: number | null; matchConfidence: number; raw: Record<string, unknown>;
}
export interface ExploriumGateway {
  searchBusinesses(params: ExploriumSearchParams): Promise<ExploriumBusinessResult[]>;
  matchBusiness(name: string, address: string | null, website: string | null): Promise<ExploriumBusinessResult | null>;
}
export class ExploriumGatewayService implements ExploriumGateway { constructor(private readonly apiKey: string) {} /* fetch cru, sem SDK, contra a REST API da Explorium */ }
```
Documente com comentário explícito que o contrato exato da REST API da Explorium (base URL, header de auth, shape de request/response de busca e de match) **não foi verificado nesta sessão** — foi inferido a partir das ferramentas MCP "Vibe Prospecting" (que usam a mesma API por trás, mas não são chamáveis a partir do backend em produção). Use o shape mais plausível (`POST https://api.explorium.ai/v1/businesses/search` ou similar) mas isole toda a URL/headers numa constante/método fácil de corrigir.

**`src/camofox-gateway.ts`** — corrige o `CamofoxScrapingClient` do branch antigo (`apps/api/src/infrastructure/scraping/camofox-scraping.client.ts` em `../feat-prospecting-outbound`, leia como referência do `CallQueue` de rate-limit, que estava certo e deve ser reaproveitado) contra a API **real e confirmada** do https://github.com/jo-inc/camofox-browser:
```ts
export interface CamofoxSearchParams { macro: '@google_search' | '@yelp_search' | '@reddit_search'; query: string; limit: number }
export interface CamofoxSearchResult { title: string | null; url: string; textContent: string | null; raw: Record<string, unknown> }
export interface CamofoxGateway { search(params: CamofoxSearchParams): Promise<CamofoxSearchResult[]> }
export class CamofoxGatewayService implements CamofoxGateway {
  constructor(private readonly baseUrl: string, private readonly accessKey?: string) {}
  // POST {baseUrl}/tabs {userId: 'opsmind-leads', sessionKey: randomUUID(), url: 'about:blank'}
  // POST {baseUrl}/tabs/:id/navigate {userId, macro: params.macro, query: params.query}
  // GET {baseUrl}/tabs/:id/snapshot
  // DELETE {baseUrl}/tabs/:id  (sempre, inclusive em caso de erro — usar try/finally)
  // Authorization: Bearer {accessKey} em todo request quando accessKey estiver setado (CAMOFOX_ACCESS_KEY)
}
```
Mantenha um `CallQueue` interno (concurrency=1, intervalo mínimo configurável ~2000ms entre chamadas) — reaproveite a implementação do branch antigo quase verbatim, ela já estava correta.

`src/index.ts` — barrel export dos 3 gateways + seus tipos.

**Docker**: adicionar serviço `camofox` a `infra/docker/docker-compose.yml`:
```yaml
camofox:
  build:
    context: https://github.com/jo-inc/camofox-browser.git
  ports:
    - "9377:9377"
  environment:
    CAMOFOX_PORT: "9377"
```
Se o build a partir da URL git falhar (não testável nesta sessão sem rodar Docker de verdade), documente no `infra/docker/README.md` (crie se não existir) o fallback manual: `git clone https://github.com/jo-inc/camofox-browser && cd camofox-browser && npm install && npm start`.

**Verificação**: `pnpm install` reconhece o novo workspace, `pnpm --filter @opsmind/integrations typecheck` limpo, testes unitários de `mapApifyItemToLead()` contra um fixture JSON gravado (crie um `fixtures/apify-google-maps-item.sample.json` com um item de exemplo plausível), `pnpm typecheck` do monorepo inteiro continua limpo.

---

## Task 4: `apps/worker` — fila, processor e budget de scraping

**Depende das Tasks 1, 2 e 3.**

1. `apps/worker/src/budget.ts` (novo) — versão framework-free do que `BudgetService` faz para IA, mas com `kind: 'scraping'` fixo: `isOverBudget(redis, organizationId, monthlyBudget)`, `recordSpend(redis, organizationId, cost)`, key Redis `scraping-budget:<organizationId>:<YYYY-MM>`, mesma lógica de `incrbyfloat` + `expire NX` que `apps/api/src/modules/ai/services/budget.service.ts` já tem — leia esse arquivo e replique o padrão (não importe-o, `apps/worker` não pode).

2. `apps/worker/src/lead-scrape-queue.ts` (novo) — `createLeadScrapeQueue(connection)`/`createLeadScrapeWorker(connection, processor)`, mesmo padrão de `apps/worker/src/queue.ts` (leia-o), usando `LEAD_SCRAPE_QUEUE` de `@opsmind/shared-types`.

3. `apps/worker/src/lead-scrape-processor.ts` (novo) — `processLeadScrapeJob(prisma, gateways, redis, data: LeadScrapeJobData)`. Leia `apps/worker/src/automation-processor.ts` inteiro primeiro como referência de padrão (uso de `withTenantContext`, tratamento de erro, tenant-context.ts).

   **Divergência deliberada do padrão de `automation-processor.ts`**: em vez de UMA transação Postgres gigante (automations são rápidas; isso envolve uma chamada de rede potencialmente longa a um gateway externo — segurar uma transação/conexão aberta por minutos arrisca esgotar o pool), use 3 transações curtas ao redor de 1 fase sem transação:
   1. tx curta (`withTenantContext`): `scrapeJob.update({status: 'RUNNING', startedAt: new Date()})`.
   2. **fora de qualquer transação**: recarregue o `ScrapeJob` completo; re-verifique orçamento de scraping (`budget.isOverBudget`) — se estourado, pule para o passo 4 com status `FAILED` e `errorMessage` claro (não gaste nada); escolha o gateway certo por um registry `Record<ScrapeSourceType, (params) => Promise<RawCandidate[]>>` (`APIFY_GOOGLE_MAPS`→`gateways.apify.searchBusinesses`, `EXPLORIUM_BUSINESS_SEARCH`→`gateways.explorium.searchBusinesses`, `CAMOFOX_GOOGLE_SEARCH`/`CAMOFOX_REDDIT_SEARCH`→`gateways.camofox.search` com o macro correspondente, `MANUAL`→lança erro "MANUAL não é uma fonte de scraping automatizável"); filtre por `onlyWithoutWebsite` quando aplicável (Apify/Explorium só, resultados Camoufox não têm campo `website` estruturado); para cada candidato de fonte estruturada, tente enriquecer via `gateways.explorium.matchBusiness(name, address, website)` **em try/catch por lead** — uma falha de enrichment não derruba o job inteiro, só aquele lead fica sem `firmographics`.
   3. tx curta: para cada resultado, `lead.upsert` (chave `organizationId_placeId` quando existir placeId; para leads Camoufox sem placeId, dedupe por `organizationId+sourceType+url-normalizada`, decida e documente a estratégia exata no código) + grava `LeadEnrichment{type:'explorium_firmographics'}` quando houve enrichment + calcula `score`/`scoreBreakdown`/`status` inline via `scoreLead()` de `@opsmind/shared-types`.
   4. tx curta: `scrapeJob.update({status: terminal, leadsFound, finishedAt: new Date(), errorMessage?})`; fora da tx, `budget.recordSpend` (custo estimado — use uma constante `SCRAPING_COST_PER_LEAD_USD` por fonte, documentando que é estimativa) e um `AuditLog` via `prisma` direto.
   Qualquer erro não capturado no meio: `catch` externo marca `FAILED` com `errorMessage` via `prisma` direto (nunca dentro de uma tx já revertida) — o job sempre termina em status terminal, nunca fica "pendurado".

4. `apps/worker/src/main.ts` — adicionar o segundo par fila/worker (`createLeadScrapeQueue`/`createLeadScrapeWorker`) ao lado do de automations já existente, `worker.on('failed', ...)` → Sentry, instanciar os 3 gateways de `@opsmind/integrations` a partir de `env.APIFY_API_TOKEN` etc. (quando ausentes, o gateway correspondente deve lançar erro claro só quando de fato chamado, nunca no boot).

5. `apps/api/src/infrastructure/queue/lead-scrape-queue.service.ts` (novo) — producer, espelhando `automation-queue.service.ts` exatamente (conexão IORedis dedicada, mesma justificativa de versão do BullMQ). Registrar em `apps/api/src/infrastructure/queue/queue.module.ts` ao lado do de automations.

Testes: `apps/worker/src/lead-scrape-processor.spec.ts` — gateways fake (objetos simples satisfazendo as interfaces) injetados, mesma infra de teste que `automation-processor.spec.ts` já usa (leia-o para replicar o setup de DB de teste). Cubra: sucesso com Apify retornando leads sem site, orçamento estourado (job falha sem gastar), erro de rede do gateway principal (job `FAILED` com mensagem clara), erro de enrichment em 1 lead não derruba o job.

**Verificação**: `pnpm --filter worker test`, `pnpm --filter worker typecheck`, `pnpm typecheck` do monorepo.

---

## Task 5: `apps/api/src/modules/leads/` — módulo completo

**Depende das Tasks 1, 2 e 3 — não depende da Task 4** (pode rodar em paralelo com ela).

Nome do módulo: `leads` (não `prospecting`). Estrutura (siga o padrão exato de qualquer módulo existente, ex. `apps/api/src/modules/customers/` ou `apps/api/src/modules/automations/`):

- `leads.module.ts` — importa `ScrapingModule`(novo, wrapping os 3 gateways de `@opsmind/integrations` via `useFactory`+`ConfigService`), `OrganizationsModule`; registra todos os controllers/services abaixo; **re-registra `AI_GATEWAY` e `BudgetService` como providers próprios** (não importa `AiModule` — `AiModule` vai importar `LeadsModule` na Task 6, e NestJS não aceita import circular; leia `apps/api/src/modules/ai/ai.module.ts` e `apps/api/src/modules/ai/services/budget.service.ts` para replicar exatamente como providers).
- `service-offerings.service.ts`/`.controller.ts`/`dto/create-service-offering.dto.ts`/`dto/update-service-offering.dto.ts` — CRUD simples (create/list `?isActive=`/findOne/update/delete), adaptado quase verbatim de `../feat-prospecting-outbound/apps/api/src/modules/prospecting/service-offerings.service.ts` (leia como referência), ajustando os campos novos (`targetIndustries`, `minEmployees`, `maxEmployees`, `minRevenueUsd`, `maxRevenueUsd`) na DTO e no service.
- `scrape-jobs.service.ts`/`.controller.ts`/`dto/create-scrape-job.dto.ts` — `create(organizationId, dto, actor)`: valida `sourceType` é um dos 4 automatizáveis (rejeita `MANUAL` com 400), cria `ScrapeJob` (`status: QUEUED`), enfileira via `LeadScrapeQueueService.enqueue({organizationId, scrapeJobId, actorType, actorId})`. `list`/`findOne` simples. DTO: `{sourceType: ScrapeSourceType (excluindo MANUAL, validar com @IsIn), city: string (@IsNotEmpty @MaxLength(120)), state: string (@IsNotEmpty @MaxLength(60)), businessType: string (@IsNotEmpty @MaxLength(120)), onlyWithoutWebsite?: boolean (@IsOptional @IsBoolean, default true), limit?: number (@IsOptional @IsInt @Min(1) @Max(200))}`.
- `leads.service.ts`/`.controller.ts`/`dto/create-lead.dto.ts` (manual)/`dto/update-lead.dto.ts`/`dto/list-leads-query.dto.ts`/`dto/convert-lead.dto.ts`:
  - `create` (manual), `findByIdOrThrow`, `list(filter: {status?, sourceType?, minScore?, city?, state?, hasWebsite?, search?})`, `update(status?, contactHandle-equivalentes)`.
  - `convertToCustomer(organizationId, leadId, dto, actorUserId)`: dentro de uma transação (a de request já aberta, chame sequencialmente), cria `Customer` (`name` do lead, `company: lead.name`, `phone`, `email`, `status: 'LEAD'`) + `lead.update({status: 'CONVERTED', convertedCustomerId})`; rejeita com 409 se `lead.convertedCustomerId` já setado; audit log `lead.converted`.
  - `POST /:leadId/enrich`: chama `ExploriumGateway.matchBusiness` sob demanda (single lead, fora do fluxo de scrape em massa), grava `LeadEnrichment`, recalcula score.
  - `POST /:leadId/score`: chama `scoreLead()` puro, atualiza `score`/`scoreBreakdown`/`status`.
- `outreach.service.ts`/`outreach-messages.controller.ts`/DTOs — adaptado **quase verbatim** de `../feat-prospecting-outbound/apps/api/src/modules/prospecting/outreach.service.ts` (459 linhas — leia o arquivo inteiro, é o maior reaproveitamento desta task): mesma máquina de estados (`applyTransition` com `updateMany` condicional no WHERE pra evitar race TOCTOU entre approve/reject concorrentes), mesmo audit log em toda transição, mesma chamada de IA one-shot sem loop agentic (`tools: []`) pra gerar o rascunho. Só troque: `OutreachChannel` values (email/telefone/whatsapp/linkedin/reddit no lugar de reddit-only), e o texto do prompt do sistema pra falar de "este negócio não tem site" em vez de citar um post do Reddit.
- `lead-analysis.service.ts` (novo, não existe no branch antigo) — `analyzeLeadPotential(organizationId, leadId, actor)`: checa `BudgetService.isOverBudget(orgId, aiMonthlyBudget, 'ai')`, monta um prompt citando os dados reais do lead (nome, categoria, rating, sem site, firmographics se houver) pedindo uma explicação em português de por que esse lead é (ou não) um bom alvo, chamada one-shot ao `AI_GATEWAY` (`tools: []`, mesmo padrão do outreach), persiste `AIRequest` e grava o resultado como `LeadEnrichment{type:'ai_analysis', data: {text}}` (não muta `Lead` diretamente).

**Rotas** (todas sob `organizations/:organizationId/...`, `TenantGuard` de classe, mutações com `WRITE_ROLES`+`RolesGuard`):
```
service-offerings                GET/POST
service-offerings/:id             GET/PATCH/DELETE
scrape-jobs                       GET/POST
scrape-jobs/:id                    GET
leads                             GET/POST
leads/:leadId                      GET/PATCH
leads/:leadId/score                POST
leads/:leadId/enrich               POST
leads/:leadId/analyze              POST
leads/:leadId/convert              POST
leads/:leadId/outreach-messages           GET/POST
outreach-messages                  GET (?status=)
outreach-messages/:id               GET
outreach-messages/:id/approve|reject|regenerate|mark-sent|mark-replied   POST
```

Também: `apps/api/src/modules/organizations/dto/update-organization.dto.ts` ganha `scrapingMonthlyBudget?: number | null` (mesma validação/serialização Decimal↔number que `aiMonthlyBudget` já tem — leia `organizations.controller.ts`/`organizations.service.ts` pra replicar exatamente).

Teste: `apps/api/test/leads.e2e-spec.ts`, adaptado do fluxo de `../feat-prospecting-outbound/apps/api/test/prospecting.e2e-spec.ts` (leia-o inteiro): offering → scrape-job (com `ApifyGateway`/`ExploriumGateway`/`CamofoxGateway` mockados via `overrideProvider`, mesmo padrão já usado em `apps/api/test/ai.e2e-spec.ts` para `AI_GATEWAY` — leia esse arquivo para o padrão exato de override) → aguarda job completar (ou processe sincronamente no teste, sem fila real) → lead aparece com score → enrich manual → outreach draft (mock `AI_GATEWAY`) → tentativa de mark-sent prematuro bloqueada com 400 → approve (audit log gravado) → mark-sent → convert-to-customer → isolamento cross-tenant (segunda org não vê nem acessa por ID direto, 404).

**Verificação**: `pnpm --filter api test`, `pnpm --filter api typecheck`, `pnpm --filter api lint`; e2e roda contra Postgres/Redis locais (`pnpm turbo run test:e2e`, filtrado ao pacote api se possível).

---

## Task 6: AI tools (`apps/api/src/modules/ai/tools/`)

**Depende da Task 5.**

Quatro tools novas, seguindo exatamente o formato de `AiTool` (`apps/api/src/modules/ai/tools/ai-tool.interface.ts`) e o estilo de `create-task.tool.ts`/`search-documents.tool.ts` (leia ambos):

- `find-leads.tool.ts` (`find_leads`): input `{city: string, state: string, businessType: string, sourceType?: 'APIFY_GOOGLE_MAPS'|'EXPLORIUM_BUSINESS_SEARCH'|'CAMOFOX_GOOGLE_SEARCH'|'CAMOFOX_REDDIT_SEARCH' (default 'APIFY_GOOGLE_MAPS'), onlyWithoutWebsite?: boolean, limit?: number}`. Gated por `WRITE_ROLES` (checar `context.role` dentro do `execute`, lançar `ForbiddenException` se não estiver em `WRITE_ROLES` — o endpoint de chat não tem guard de role próprio). Chama `ScrapeJobsService.create(...)`, retorna `{scrapeJobId, status}` **sem esperar o job terminar** (mesmo padrão non-blocking do branch antigo — comentário explicando por quê).
- `score-lead.tool.ts` (`score_lead`): input `{leadId: string}`. Sem gate de role (cálculo determinístico, mesma justificativa de `list_inactive_customers`). Chama `LeadsService`/scoring, retorna o `scoreBreakdown`.
- `analyze-lead-potential.tool.ts` (`analyze_lead_potential`, novo): input `{leadId: string}`. Gated por `WRITE_ROLES` (custa budget de IA). Chama `LeadAnalysisService.analyzeLeadPotential`.
- `generate-outreach-message.tool.ts` (`generate_outreach_message`): input `{leadId: string, channel: OutreachChannel, serviceOfferingId?: string}`. Gated por `WRITE_ROLES`. Chama `OutreachService.generateDraft`. **Inclua no topo do arquivo o mesmo comentário de regra dura do branch antigo** (leia `../feat-prospecting-outbound/apps/api/src/modules/ai/tools/generate-outreach-message.tool.ts`): nunca criar uma tool `approve_outreach_message`/`send_outreach_message` — aprovação e envio são sempre ação humana via REST, nunca IA.

Registrar as 4 em `apps/api/src/modules/ai/ai.module.ts`: adicionar `LeadsModule` a `imports`, adicionar as 4 classes ao `useFactory`/`inject` do provider `AI_TOOLS` (leia o arquivo, o padrão já existe pras 6 tools atuais).

Testes: um `.spec.ts` por tool, seguindo o padrão exato dos specs existentes em `apps/api/src/modules/ai/tools/*.spec.ts` (mock dos services injetados, asserts de gate de role, assert do formato de saída).

**Verificação**: `pnpm --filter api test -- tools`, `pnpm --filter api typecheck`.

---

## Task 7: Frontend — design tokens + componentes novos de `components/ui/`

**Independente de tudo (pode rodar em paralelo com as Tasks 1-6, contra dados mockados).**

1. `apps/web/app/globals.css` — adicionar ao bloco `@theme` existente (sem tocar em nada que já existe, incluindo o `body{background:#f8fafc;color:#0f172a}`):
```css
--color-ink-950: #0a0a0a;
--color-ink-900: #131313;
--color-ink-800: #1a1a1a;
--color-ink-700: #232323;
--color-ink-500: #6b6b6b;
--color-ink-300: #a3a3a3;
--color-ink-50:  #f5f5f5;
--color-accent-400: #f7952e;
--color-accent-500: #f5820d;
--color-accent-600: #d96e04;
--color-positive-500: #22c55e;
--color-negative-500: #ef4444;
```

2. `apps/web/components/ui/table.tsx` (novo) — `Table`/`TableHead`/`TableBody`/`TableRow`/`TableCell` compostos, HTML `<table>` puro + classes Tailwind usando os tokens `ink-*` (sem lib de tabela). Siga o estilo `clsx`-simples de `apps/web/components/ui/card.tsx`.

3. `apps/web/components/ui/dialog.tsx` (novo) — overlay controlado (`open`/`onClose` props, `fixed inset-0` com backdrop), sem Radix/headless-UI (mesmo espírito zero-libs-pesadas do resto do design system). Precisa suportar Escape-to-close e click-fora-fecha.

4. Estender `apps/web/components/ui/badge.tsx` — adicionar ao `COLORS` record todos os novos valores de status: `DISCOVERED, QUALIFIED, DISQUALIFIED, OUTREACH_DRAFTED, OUTREACH_APPROVED, CONTACTED, REPLIED, CONVERTED, LOST` (LeadStatus) e `DRAFT, APPROVED, REJECTED, SENT, REPLIED` (OutreachStatus — note que `REPLIED` já existiria só uma vez no record já que é string-keyed).

5. Instalar `recharts`: `pnpm add recharts --filter web`. Criar `apps/web/components/ui/chart-card.tsx` — wrapper `Card` + um componente de gráfico `recharts`, cores passadas como hex literal (recharts não lê CSS custom properties) usando os mesmos valores hex dos tokens acima. Exporte pelo menos: `SparklineChart` (area chart minimalista pra dentro de um KPI tile), `DonutChart`, `BarChartHighlighted` (uma barra em destaque), `LineChartWithTooltip`.

6. `apps/web/components/leads/lead-score-bar.tsx` (novo) — reaproveita o padrão visual traffic-light de `apps/web/components/ai/budget-bar.tsx` (leia-o) — verde ≥70 / âmbar 40-69 / cinza <40 — expansível (clique revela o `scoreBreakdown`), reaproveitando o padrão de linha expansível de `apps/web/components/ai/ai-usage-panel.tsx`'s `RequestTrace` (leia-o).

**Verificação**: `pnpm --filter web typecheck`, `pnpm --filter web lint`, `pnpm --filter web build` (garante que os componentes novos compilam de verdade, mesmo sem página nenhuma os usando ainda — crie uma página de smoke-test temporária se necessário só pra build, ou confie no typecheck).

---

## Task 8: Frontend — páginas de Leads/Outreach, hooks, nav

**Depende da Task 7. Para dados reais depende também da Task 5, mas pode ser construída e revisada contra a Task 5 já mergeada (não precisa esperar a Task 6).**

1. Hooks em `apps/web/lib/leads/`: `use-service-offerings.ts`, `use-scrape-jobs.ts` (inclua polling `refetchInterval` enquanto algum job está `QUEUED`/`RUNNING`, mesmo padrão do branch antigo em `../feat-prospecting-outbound/apps/web/lib/prospecting/use-scrape-jobs.ts` — leia como referência), `use-leads.ts`, `use-lead-enrichment.ts`, `use-outreach-messages.ts`. Siga exatamente o padrão de `apps/web/lib/customers/use-customers.ts` (leia-o): um hook por operação, `queryKey: ['organizations', organizationId, 'leads', ...]`, `invalidateQueries` no sucesso de cada mutation.

2. `apps/web/app/organizations/[organizationId]/leads/page.tsx` — container raiz com `bg-ink-950 text-ink-50 min-h-screen` (ou aplicado num wrapper, decida a forma mais simples de não vazar pro `AppHeader`/`AppNav` compartilhados). Filtro (cidade/estado/tipo/status/tem-site) + botão "Nova busca" abrindo um `Dialog` com formulário (`react-hook-form`+`zod`, mesmo padrão de `apps/web/app/organizations/[organizationId]/customers/page.tsx` — leia-o) escolhendo a fonte entre as 4 automatizáveis + `Table` de leads (nome, cidade/estado, categoria, badge "Sem site"/"Com site", `LeadScoreBar`, `Badge` de status, link pro detalhe) + painel colapsável de scrape jobs recentes.

3. `apps/web/app/organizations/[organizationId]/leads/[leadId]/page.tsx` — dados do negócio, `LeadScoreBar` + breakdown, histórico de `LeadEnrichment`, thread de outreach (gerar/aprovar/rejeitar/regenerar/marcar-enviado/marcar-respondido, cada ação visível só conforme `WRITE_ROLES`), botão "Converter em Cliente" (abre `Dialog` de confirmação, no sucesso redireciona pro `Customer` recém-criado), botão "Analisar potencial" (chama `/analyze`, mostra o texto retornado).

4. `apps/web/app/organizations/[organizationId]/outreach/page.tsx` — fila de aprovação global (`GET outreach-messages?status=DRAFT` por padrão, com filtro de status), ações inline de aprovar/rejeitar, link de volta pro lead de origem.

5. `apps/web/components/app-nav.tsx` — adicionar `{path: 'leads', label: 'Leads'}` e `{path: 'outreach', label: 'Aprovações'}` ao array `TABS`, na posição logo após Dashboard. A lógica de active-match já existente (`startsWith(href + '/')`) já lida corretamente com isso — confirme lendo o arquivo antes de mexer, não reescreva a lógica de matching.

**Verificação**: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`. Sem infraestrutura de teste de frontend no projeto hoje — não crie uma nova sem necessidade; se quiser, adicione um smoke manual documentado no relatório da task (passos pra clicar e verificar rodando `pnpm --filter web dev`).

---

## Task 9: Redesign do Dashboard

**Depende da Task 8** (reaproveita os componentes de chart já validados nas páginas de Leads).

Backend: `apps/api/src/modules/dashboard/dashboard.service.ts` ganha um método novo `getLeadPipelineOverview(organizationId)` **aditivo** (o `getOverview()` existente não muda nada) computando: `totalLeads`, `leadsWithoutWebsite` (count `website IS NULL OR website = ''`), `qualificationRate` (`QUALIFIED / (QUALIFIED + DISQUALIFIED)`, 0 se denominador zero), `leadsByStatus` (`groupBy status`), `leadsByCity` (`groupBy [city,state]`, top 8 por contagem), `leadsByDay` (últimos 30 dias, via `$queryRaw` com `date_trunc('day', discovered_at)` — Prisma não tem `groupBy` por data truncada; siga o precedente de raw SQL já usado em `DocumentChunk`), `recentLeads` (últimos 8), `recentScrapeJobs` (últimos 5). Nova rota `GET organizations/:organizationId/dashboard/leads` no `dashboard.controller.ts`, mesmo padrão do endpoint existente (`TenantGuard`, sem `WRITE_ROLES` — leitura).

Frontend: `apps/web/lib/dashboard/use-dashboard.ts` ganha `useLeadPipelineOverview(organizationId)`. `apps/web/app/organizations/[organizationId]/dashboard/page.tsx` é reescrita: container `bg-ink-950 text-ink-50`, seção nova no topo (hero) com os widgets abaixo, e a seção existente de Clientes/Tarefas (4 `StatCard`s + atividade recente) preservada **sem alteração de lógica**, numa fileira secundária abaixo, mantendo o visual claro atual pra essa parte (ou adaptando as cores pro tema escuro se ficar visualmente estranho misturado — decida pela leitura visual, documentando a escolha no relatório).

Widgets novos (usando os componentes da Task 7):
1. KPI "Leads sem site" — contagem + `SparklineChart` (14 dias) + badge de delta.
2. KPI "Leads encontrados (mês)" — contagem + sparkline + delta verde/vermelho.
3. KPI "Taxa de qualificação" — percentual + tendência pequena.
4. `DonutChart` — leads por status.
5. `BarChartHighlighted` — leads por cidade (uma barra em destaque, a de mais leads sem site).
6. `LineChartWithTooltip` — leads ao longo do tempo (30 dias), ponto mais recente destacado.
7. Lista "Leads recentes" (nome, cidade, `LeadScoreBar` compacto, `Badge` de status).
8. Lista "Atividade de scrape jobs" (status, cidade/estado/tipo, `leadsFound`).

Não inclua o tile "Pipeline (valor estimado)" nesta task — não há campo de valor de negócio modelado; se quiser, documente isso como nota no relatório em vez de inventar um campo novo fora do schema já decidido.

**Verificação**: `pnpm --filter api test` (novo método testado em `dashboard.service.spec.ts`, seguindo o padrão do teste existente), `pnpm --filter web typecheck && build`, e-2-e manual (`pnpm dev`, olhar a página).

---

## Task 10: Testes finais de integração e limpeza

**Depende de todas as tasks anteriores.**

1. Rode a suíte completa: `pnpm lint && pnpm typecheck && pnpm test && pnpm turbo run test:e2e` na raiz do monorepo (precisa de Postgres/Redis locais de pé — `docker compose -f infra/docker/docker-compose.yml up -d`, migrations aplicadas, role restrita criada — siga exatamente os passos do `.github/workflows/ci.yml` se algo falhar por falta de setup). Corrija qualquer regressão encontrada nesta rodada final (não deveria haver nenhuma se as tasks anteriores foram revisadas corretamente — se houver, é sinal de que algo escapou de uma review anterior).
2. Confira que `pnpm --filter api eval` (suíte de eval de IA da Fase 7) continua passando sem regressão — as tools novas não devem quebrar o dataset de eval existente (elas não são exercitadas por ele, mas confirme que o boot da `AiModule` com `LeadsModule` importado não quebra nada).
3. Escreva/atualize a seção relevante do `CLAUDE.md` da raiz descrevendo a nova arquitetura de Leads (fontes plugáveis, onde vivem os gateways, o padrão de scoring híbrido) — siga o estilo e a densidade do `CLAUDE.md` já existente, sem repetir o que já está documentado sobre RLS/AI/worker (só o que é novo/específico de Leads).

**Verificação**: toda a suíte verde, `CLAUDE.md` atualizado e revisado por leitura humana no relatório final.
