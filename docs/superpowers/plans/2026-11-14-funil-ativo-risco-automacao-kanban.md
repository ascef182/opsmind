# Funil ativo: radar de risco, gatilhos de automação e Kanban arrastável — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar visibilidade auditável de quais Deals estão em risco de esfriar, criar automaticamente uma tarefa de reativação quando isso acontece (via o motor de Automations já existente), e deixar o usuário mudar a etapa de um Deal arrastando o card em vez de usar um `<Select>`.

**Architecture:** Uma função pura nova (`computeDealRisk`) alimenta três superfícies: a resposta da API de Deals (badge de risco), o scan periódico do worker (dois novos `AutomationTrigger`), e o processor de automação que já existe. O Kanban ganha drag-and-drop chamando exatamente o mesmo endpoint `move-stage` que o `<Select>` já chama hoje.

**Tech Stack:** NestJS (`apps/api`), BullMQ worker (`apps/worker`), Next.js 14 App Router (`apps/web`), Prisma/Postgres, `@hello-pangea/dnd` (novo).

**Spec:** `docs/superpowers/specs/2026-11-14-funil-ativo-design.md`

## Global Constraints

- Nunca criar uma segunda forma de mudar `Deal.stage` fora de `DealsService.moveStage()` — tanto o `<Select>` (onde ainda existir) quanto o drag chamam exatamente esse método/endpoint.
- Nunca calcular risco/tempo-parado com uma chamada de IA — `computeDealRisk` é uma função pura, sem gateway, testável isoladamente.
- `DealStage` continua um enum fixo — nenhuma tabela de etapas configuráveis por organização.
- `DEFAULT_EXPECTED_STAGE_DURATION_HOURS` é uma constante por enum; não vira coluna em `Organization`.
- Drag move só entre colunas (muda a etapa) — nenhuma reordenação dentro da mesma coluna no v1.
- Segurança (pedido explícito do usuário): `dealId`/`organizationId` nunca chegam como campo controlável pelo cliente fora do padrão já usado no resto do schema — `dealId` em `AutomationRun`/`AutomationExecutionJobData` é sempre derivado internamente pelo scan do worker, nunca aceito de um DTO público; toda query nova filtra por `organizationId` (RLS + filtro de aplicação, mesmo padrão de todo o resto do schema).
- Biblioteca de drag-and-drop: `@hello-pangea/dnd` (decisão já tomada no design).

## Review Focus

- Deal reaberto (`LOST` → `QUALIFICATION`) precisa resetar `stageEnteredAt` — senão o radar marca o deal como `AT_RISK` imediatamente após reabrir, usando o timestamp antigo (Task 3).
- Deal movido para `WON`/`LOST` precisa virar `NOT_APPLICABLE` na resposta da API imediatamente, e os dois scans novos precisam excluir deals fechados — senão um deal ganho continua gerando tarefas de reativação para sempre (Tasks 3, 6, 7).
- Ação `notify` sem `deal.ownerUserId` não pode lançar erro — mesma classe de bug que já existe (e já é tratada) para `customer.ownerUserId` em `CUSTOMER_INACTIVE`, mas agora contra o owner do Deal (Task 8).
- Drag para uma coluna cujo destino não está em `DEAL_STAGE_TRANSITIONS[origem]` precisa ser rejeitado sem chamar a API e sem mover o card visualmente (Task 10).
- Drag para `LOST` sem motivo informado no prompt não pode disparar a mutation — mesma regra que o `<Select>` já aplica hoje (Task 10).

---

### Task 1: `computeDealRisk` — função pura de risco por etapa

**Files:**
- Create: `packages/shared-types/src/deal-risk.ts`
- Test: `packages/shared-types/src/deal-risk.spec.ts`
- Modify: `packages/shared-types/src/index.ts` (adicionar `export * from './deal-risk';`)

**Interfaces:**
- Consumes: nada (função pura, sem dependência de framework ou de outra task).
- Produces: `DealStage` (tipo local, união de string — mesmos 6 valores do enum Prisma, mesmo padrão de duplicação de `AuditActorType` em `audit.types.ts`), `DealRiskBucket = 'ON_TRACK' | 'COOLING' | 'AT_RISK' | 'NOT_APPLICABLE'`, `DEFAULT_EXPECTED_STAGE_DURATION_HOURS: Record<DealStage, number>`, `COOLING_THRESHOLD_RATIO = 0.7`, `computeDealRisk(deal: { stage: DealStage; stageEnteredAt: Date }, now: Date, expectedStageDurationHours?: Record<DealStage, number>): DealRiskBucket`. Tasks 3, 6, 7 consomem essa assinatura exatamente.

- [ ] **Step 1: Write the failing tests**

```ts
import { computeDealRisk, DEFAULT_EXPECTED_STAGE_DURATION_HOURS } from './deal-risk';

describe('computeDealRisk', () => {
  it('retorna NOT_APPLICABLE para stage WON, independente do tempo parado', () => {
    const result = computeDealRisk({ stage: 'WON', stageEnteredAt: new Date('2000-01-01') }, new Date());
    expect(result).toBe('NOT_APPLICABLE');
  });

  it('retorna NOT_APPLICABLE para stage LOST', () => {
    const result = computeDealRisk({ stage: 'LOST', stageEnteredAt: new Date('2000-01-01') }, new Date());
    expect(result).toBe('NOT_APPLICABLE');
  });

  it('retorna ON_TRACK quando o tempo na etapa está bem abaixo do esperado', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const result = computeDealRisk({ stage: 'QUALIFICATION', stageEnteredAt: new Date('2026-01-09T12:00:00Z') }, now);
    expect(result).toBe('ON_TRACK');
  });

  it('retorna COOLING quando o tempo na etapa passa de 70% do esperado mas não atingiu 100%', () => {
    // QUALIFICATION default = 72h; 70% = 50.4h
    const now = new Date('2026-01-10T00:00:00Z');
    const result = computeDealRisk({ stage: 'QUALIFICATION', stageEnteredAt: new Date('2026-01-07T12:00:00Z') }, now);
    expect(result).toBe('COOLING');
  });

  it('retorna AT_RISK quando o tempo na etapa atinge ou passa do esperado', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const result = computeDealRisk({ stage: 'QUALIFICATION', stageEnteredAt: new Date('2026-01-01T00:00:00Z') }, now);
    expect(result).toBe('AT_RISK');
  });

  it('usa o override de horas por etapa quando fornecido, em vez do default', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const stageEnteredAt = new Date('2026-01-09T00:00:00Z'); // 24h parado
    const defaultResult = computeDealRisk({ stage: 'QUALIFICATION', stageEnteredAt }, now);
    const overridden = computeDealRisk(
      { stage: 'QUALIFICATION', stageEnteredAt },
      now,
      { ...DEFAULT_EXPECTED_STAGE_DURATION_HOURS, QUALIFICATION: 12 },
    );
    expect(defaultResult).toBe('ON_TRACK'); // 24h < 70% de 72h
    expect(overridden).toBe('AT_RISK'); // 24h >= 12h
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter shared-types test -- deal-risk`
Expected: FAIL — `Cannot find module './deal-risk'`.

- [ ] **Step 3: Implement `deal-risk.ts`**

Valores de `DEFAULT_EXPECTED_STAGE_DURATION_HOURS`: `QUALIFICATION: 72, PROPOSAL: 120, NEGOTIATION: 168, CONTRACT_SENT: 72, WON: 0, LOST: 0` (os dois últimos nunca são lidos — `computeDealRisk` retorna `NOT_APPLICABLE` antes de consultá-los, mas o `Record<DealStage, number>` precisa ser total). Horas na etapa = `(now.getTime() - stageEnteredAt.getTime()) / 3_600_000`; `AT_RISK` quando `hoursInStage >= expectedHours`, `COOLING` quando `hoursInStage >= expectedHours * COOLING_THRESHOLD_RATIO`, senão `ON_TRACK`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter shared-types test -- deal-risk`
Expected: PASS 6/6.

- [ ] **Step 5: Export and commit**

Add `export * from './deal-risk';` to `packages/shared-types/src/index.ts`.

```bash
git add packages/shared-types/src/deal-risk.ts packages/shared-types/src/deal-risk.spec.ts packages/shared-types/src/index.ts
git commit -m "feat(shared-types): computeDealRisk — radar de risco por etapa, função pura"
```

---

### Task 2: Migration — `Deal.stageEnteredAt`, dois `AutomationTrigger` novos, `AutomationRun.dealId`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261114180000_deal_stage_entered_at_and_automation_run_deal_id/migration.sql`
- Create: `packages/database/prisma/migrations/20261114180100_automation_trigger_deal_values/migration.sql`
- Modify: `packages/shared-types/src/automation.types.ts` (`AutomationExecutionJobData.dealId?: string`)

**Interfaces:**
- Consumes: nada.
- Produces: coluna `Deal.stageEnteredAt: DateTime` (default `now()`, backfill `createdAt` em linhas existentes); valores de enum `AutomationTrigger.DEAL_STAGE_STALE`/`DEAL_SILENT_FOR`; coluna `AutomationRun.dealId: String?` com FK para `Deal` (`onDelete: SetNull`) e índice `(automationId, dealId, status)`; campo `AutomationExecutionJobData.dealId?: string`. Tasks 3, 5, 6, 7, 8 consomem esses nomes exatamente.

Esta task é de infraestrutura (schema + migration) — sem ciclo RED/GREEN de teste automatizado (mesma categoria de exceção de TDD que a migration anterior do projeto, `20261113170000_...`), verificada por aplicação real da migration e `prisma generate`.

- [ ] **Step 1: Editar `schema.prisma`**

Em `model Deal`, adicionar `stageEnteredAt DateTime @default(now()) @map("stage_entered_at")` (ao lado de `createdAt`/`updatedAt`).

Em `enum AutomationTrigger`, adicionar `DEAL_STAGE_STALE` e `DEAL_SILENT_FOR` (comentário atualizando o que hoje diz "mais tipos entram conforme surgir necessidade real" — estes são os dois primeiros).

Em `model AutomationRun`, adicionar `dealId String? @map("deal_id")` e a relação `deal Deal? @relation(fields: [dealId], references: [id], onDelete: SetNull)`, mais `@@index([automationId, dealId, status])`. Em `model Deal`, adicionar o lado inverso `automationRuns AutomationRun[]`.

- [ ] **Step 2: Gerar o SQL de referência (sem aplicar)**

Run: `cd packages/database && npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > /tmp/diff.sql`
Expected: o diff lista as mudanças de `Deal`/`AutomationRun`/enum acima — usar como checagem cruzada, **não** copiar direto (o shadow database não tem `pgvector`, então historicamente o diff também propõe um `DROP INDEX document_chunks_embedding_hnsw_idx` espúrio — remover se aparecer, mesma observação já registrada em migrations anteriores).

- [ ] **Step 3: Escrever as duas migrations à mão**

`20261114180000_deal_stage_entered_at_and_automation_run_deal_id/migration.sql`:

```sql
ALTER TABLE "deals" ADD COLUMN "stage_entered_at" TIMESTAMP(3);
UPDATE "deals" SET "stage_entered_at" = "created_at" WHERE "stage_entered_at" IS NULL;
ALTER TABLE "deals" ALTER COLUMN "stage_entered_at" SET NOT NULL;
ALTER TABLE "deals" ALTER COLUMN "stage_entered_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "automation_runs" ADD COLUMN "deal_id" TEXT;
CREATE INDEX "automation_runs_automation_id_deal_id_status_idx" ON "automation_runs"("automation_id", "deal_id", "status");
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

`20261114180100_automation_trigger_deal_values/migration.sql` (isolado numa migration própria — `ALTER TYPE ... ADD VALUE` em sua própria transação, mesmo padrão de `20260908120100_outreach_channel_instagram_dm`):

```sql
ALTER TYPE "AutomationTrigger" ADD VALUE 'DEAL_STAGE_STALE';
ALTER TYPE "AutomationTrigger" ADD VALUE 'DEAL_SILENT_FOR';
```

- [ ] **Step 4: Aplicar e gerar o client**

Run: `pnpm --filter database exec prisma migrate deploy && pnpm --filter database exec prisma generate`
Expected: as duas migrations aplicam sem erro; `prisma generate` conclui sem erro.

- [ ] **Step 5: Confirmar o backfill**

Run: `pnpm --filter database exec prisma db execute --stdin <<< "SELECT count(*) FROM deals WHERE stage_entered_at IS NULL;"`
Expected: `count = 0`.

- [ ] **Step 6: Adicionar `dealId` ao tipo compartilhado**

Em `packages/shared-types/src/automation.types.ts`, adicionar `dealId?: string;` a `AutomationExecutionJobData`, com um comentário curto citando que só os dois triggers novos preenchem este campo.

- [ ] **Step 7: Typecheck e commit**

Run: `pnpm --filter database run build && pnpm --filter shared-types run typecheck`
Expected: ambos sem erro.

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations packages/shared-types/src/automation.types.ts
git commit -m "feat(database): Deal.stageEnteredAt, triggers DEAL_STAGE_STALE/DEAL_SILENT_FOR, AutomationRun.dealId"
```

---

### Task 3: API — `DealsService.moveStage` seta `stageEnteredAt`; respostas de Deal expõem `risk`

**Files:**
- Modify: `apps/api/src/modules/deals/deals.service.ts`
- Modify: `apps/api/src/modules/deals/deals.service.spec.ts`
- Create: `apps/api/src/modules/deals/deal-risk.util.ts`
- Create: `apps/api/src/modules/deals/deal-risk.util.spec.ts`
- Modify: `apps/api/src/modules/deals/deals.controller.ts`

**Interfaces:**
- Consumes: `computeDealRisk`, `DealRiskBucket` (Task 1); `Deal.stageEnteredAt` (Task 2).
- Produces: `DealWithRisk = Deal & { risk: DealRiskBucket }`; `attachDealRisk(deal: Deal, now?: Date): DealWithRisk`. Task 4 (web) consome o shape `{ ...Deal, risk }` na resposta JSON de `GET .../deals` e `GET .../deals/:id`.

- [ ] **Step 1: Write the failing test for `moveStage`**

Em `deals.service.spec.ts`, dentro do `describe('moveStage', ...)` já existente:

```ts
it('atualiza stageEnteredAt para agora em toda transição de etapa bem-sucedida', async () => {
  const deal = { id: 'deal-1', organizationId: 'org-1', stage: 'QUALIFICATION', stageEnteredAt: new Date('2020-01-01') };
  prisma.deal.findFirst.mockResolvedValueOnce(deal).mockResolvedValueOnce({ ...deal, stage: 'PROPOSAL' });
  prisma.deal.updateMany.mockResolvedValue({ count: 1 });

  await service.moveStage('org-1', 'deal-1', { stage: 'PROPOSAL' }, 'user-1');

  expect(prisma.deal.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ stage: 'PROPOSAL', stageEnteredAt: expect.any(Date) }) }),
  );
});

it('reseta stageEnteredAt também ao reabrir um deal de LOST para QUALIFICATION', async () => {
  const deal = { id: 'deal-1', organizationId: 'org-1', stage: 'LOST', stageEnteredAt: new Date('2000-01-01') };
  prisma.deal.findFirst.mockResolvedValueOnce(deal).mockResolvedValueOnce({ ...deal, stage: 'QUALIFICATION' });
  prisma.deal.updateMany.mockResolvedValue({ count: 1 });

  await service.moveStage('org-1', 'deal-1', { stage: 'QUALIFICATION' }, 'user-1');

  expect(prisma.deal.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ stage: 'QUALIFICATION', stageEnteredAt: expect.any(Date), lostReason: null }) }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- deals.service.spec`
Expected: FAIL — `data` não contém `stageEnteredAt`.

- [ ] **Step 3: Implementar**

Em `moveStage`, dentro do objeto `data` passado a `prisma.deal.updateMany`, adicionar `stageEnteredAt: new Date()` incondicionalmente (toda chamada bem-sucedida de `moveStage` já representa uma transição real de etapa — `ALLOWED_TRANSITIONS` nunca lista o próprio estágio como destino válido, então não existe caso de "mover para o mesmo estágio" a proteger contra).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- deals.service.spec`
Expected: PASS (todos os testes do arquivo, incluindo os pré-existentes).

- [ ] **Step 5: Write the failing test for `attachDealRisk`**

```ts
import { attachDealRisk } from './deal-risk.util';

describe('attachDealRisk', () => {
  it('calcula NOT_APPLICABLE para um deal em WON', () => {
    const deal = { id: 'd1', stage: 'WON', stageEnteredAt: new Date('2000-01-01') } as never;
    expect(attachDealRisk(deal).risk).toBe('NOT_APPLICABLE');
  });

  it('preserva todos os campos originais do Deal no retorno', () => {
    const deal = { id: 'd1', stage: 'QUALIFICATION', stageEnteredAt: new Date(), title: 'Contrato X' } as never;
    const result = attachDealRisk(deal);
    expect(result.id).toBe('d1');
    expect(result.title).toBe('Contrato X');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter api test -- deal-risk.util`
Expected: FAIL — `Cannot find module './deal-risk.util'`.

- [ ] **Step 7: Implementar `deal-risk.util.ts`**

```ts
import type { Deal } from '@opsmind/database';
import { computeDealRisk, type DealRiskBucket } from '@opsmind/shared-types';

export type DealWithRisk = Deal & { risk: DealRiskBucket };

export function attachDealRisk(deal: Deal, now: Date = new Date()): DealWithRisk {
  return { ...deal, risk: computeDealRisk({ stage: deal.stage, stageEnteredAt: deal.stageEnteredAt }, now) };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter api test -- deal-risk.util`
Expected: PASS 2/2.

- [ ] **Step 9: Usar `attachDealRisk` no controller**

Em `deals.controller.ts`, os métodos `list` e `findOne` passam a ser `async`, chamando `attachDealRisk` sobre o(s) resultado(s) de `dealsService.list`/`findByIdOrThrow` antes de retornar; tipo de retorno `Promise<DealWithRisk[]>`/`Promise<DealWithRisk>` (import de `./deal-risk.util`). Os demais métodos do controller (`create`, `update`, `moveStage`, etc.) continuam devolvendo `Deal` puro — sem mudança.

- [ ] **Step 10: Run full API suite and commit**

Run: `pnpm --filter api test`
Expected: PASS, nenhuma regressão.

```bash
git add apps/api/src/modules/deals/deals.service.ts apps/api/src/modules/deals/deals.service.spec.ts apps/api/src/modules/deals/deal-risk.util.ts apps/api/src/modules/deals/deal-risk.util.spec.ts apps/api/src/modules/deals/deals.controller.ts
git commit -m "feat(api): Deal.stageEnteredAt atualizado em moveStage; GET de deals expõe risk"
```

---

### Task 4: Web — badge de risco na tela de Deals

**Files:**
- Modify: `apps/web/lib/deals/types.ts`
- Modify: `apps/web/app/organizations/[organizationId]/deals/page.tsx`

**Interfaces:**
- Consumes: campo `risk: DealRiskBucket` e `stageEnteredAt: string` na resposta JSON de `GET .../deals` (Task 3).

Sem suíte de teste automatizado no `apps/web` (confirmado: nenhum `*.test.*`/`*.spec.tsx` e nenhum script `test` no `package.json` do web) — verificação manual, mesma convenção já usada por toda feature anterior deste app.

- [ ] **Step 1: Tipos**

Em `apps/web/lib/deals/types.ts`: adicionar `export type DealRiskBucket = 'ON_TRACK' | 'COOLING' | 'AT_RISK' | 'NOT_APPLICABLE';`, `stageEnteredAt: string;` e `risk: DealRiskBucket;` à interface `Deal`, e `export const DEAL_RISK_LABELS: Record<DealRiskBucket, string> = { ON_TRACK: 'Em dia', COOLING: 'Esfriando', AT_RISK: 'Em risco', NOT_APPLICABLE: '—' };`.

- [ ] **Step 2: Badge no `DealCard`**

Em `page.tsx`, dentro de `DealCard`, renderizar um `<Badge value={DEAL_RISK_LABELS[deal.risk]} />` (ou badge/cor condicional por bucket, reaproveitando o componente `Badge` já importado) ao lado do badge de etapa existente — omitir/esconder quando `deal.risk === 'NOT_APPLICABLE'` (deal fechado).

- [ ] **Step 3: Rodar o dev server e verificar manualmente**

Run: `pnpm --filter web dev` (ou o fluxo já em uso pela skill `run`, se aplicável)
Expected: abrir `/organizations/:id/deals`, confirmar que cada card mostra o badge de risco coerente com `stageEnteredAt`, e que deals em `WON`/`LOST` não mostram badge de risco.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/deals/types.ts "apps/web/app/organizations/[organizationId]/deals/page.tsx"
git commit -m "feat(web): badge de risco por etapa na tela de Deals"
```

---

### Task 5: API — Automations aceita os dois triggers novos

**Files:**
- Modify: `apps/api/src/modules/automations/dto/create-automation.dto.ts`
- Modify: `apps/api/src/modules/automations/automations.service.ts`
- Modify: `apps/api/src/modules/automations/automations.service.spec.ts`

**Interfaces:**
- Consumes: valores de enum `DEAL_STAGE_STALE`/`DEAL_SILENT_FOR` (Task 2).
- Produces: `DealStaleConditions { thresholdHoursOverride?: number }`, `DealStaleActions { createTask?: boolean; notify?: boolean }`, `DealSilentForConditions { silentForDays?: number }`, `DealSilentForActions { createTask?: boolean; notify?: boolean }` em `automations.service.ts` (mesmo padrão local de `CustomerInactiveConditions`/`CustomerInactiveActions` já existente nesse arquivo).

Ruling explícito deste plano: `AutomationsService.runNow` (execução manual/teste, PRD §11) **continua só suportando `CUSTOMER_INACTIVE`** nesta task — não há UI de Automations no `apps/web` hoje que dependa de "run now" para os triggers novos, e estendê-lo (que exigiria reimplementar a lógica de condição dos dois scans também dentro de `runNow`) não é exigido por nenhum Goal do design. Fica fora do v1 (YAGNI); registrar isso no ledger de execução.

- [ ] **Step 1: Write the failing test**

Em `automations.service.spec.ts`:

```ts
it('cria uma automação com trigger DEAL_STAGE_STALE e persiste conditions/actions', async () => {
  prisma.automation.create.mockResolvedValue({ id: 'auto-1', trigger: 'DEAL_STAGE_STALE' });

  await service.create('org-1', 'user-1', {
    name: 'Negócio parado',
    trigger: 'DEAL_STAGE_STALE',
    conditions: { thresholdHoursOverride: 48 },
    actions: { createTask: true, notify: false },
  });

  expect(prisma.automation.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      trigger: 'DEAL_STAGE_STALE',
      conditions: { thresholdHoursOverride: 48 },
      actions: { createTask: true, notify: false },
    }),
  });
});

it('cria uma automação com trigger DEAL_SILENT_FOR e persiste conditions/actions', async () => {
  prisma.automation.create.mockResolvedValue({ id: 'auto-2', trigger: 'DEAL_SILENT_FOR' });

  await service.create('org-1', 'user-1', {
    name: 'Cliente quieto',
    trigger: 'DEAL_SILENT_FOR',
    conditions: { silentForDays: 10 },
    actions: { createTask: true, notify: true },
  });

  expect(prisma.automation.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ trigger: 'DEAL_SILENT_FOR', conditions: { silentForDays: 10 } }),
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- automations.service.spec`
Expected: FAIL — erro de tipo/validação ao passar `trigger: 'DEAL_STAGE_STALE'` (não está em `AutomationTrigger` do client gerado antes da Task 2 estar aplicada — se já aplicada, falha porque `CreateAutomationInput['actions']` ainda só aceita `CustomerInactiveActions`, incompatível estruturalmente o bastante para o teste não compilar/typar como esperado — ajustar e confirmar falha real antes do Step 3).

- [ ] **Step 3: Implementar**

Em `automations.service.ts`: adicionar as 4 interfaces novas descritas acima; mudar `CreateAutomationInput['conditions']`/`['actions']` para uniões (`CustomerInactiveConditions | DealStaleConditions | DealSilentForConditions`, idem para actions — as três actions têm o mesmo shape `{ createTask?; notify? }`, mas mantidas como tipos nominalmente distintos para espelhar o padrão de uma interface por trigger já estabelecido no arquivo). Em `create-automation.dto.ts`, adicionar os dois valores novos ao array `AUTOMATION_TRIGGERS`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- automations.service.spec`
Expected: PASS, incluindo os testes pré-existentes do arquivo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/automations/dto/create-automation.dto.ts apps/api/src/modules/automations/automations.service.ts apps/api/src/modules/automations/automations.service.spec.ts
git commit -m "feat(api): Automations aceita triggers DEAL_STAGE_STALE e DEAL_SILENT_FOR"
```

---

### Task 6: Worker — scan de `DEAL_STAGE_STALE`

**Files:**
- Modify: `apps/worker/src/automation-scan.ts`
- Modify: `apps/worker/src/automation-scan.spec.ts`

**Interfaces:**
- Consumes: `computeDealRisk`, `DEFAULT_EXPECTED_STAGE_DURATION_HOURS`, `DealStage` (Task 1); `Deal.stageEnteredAt`, `AutomationTrigger.DEAL_STAGE_STALE`, `AutomationExecutionJobData.dealId` (Task 2).
- Produces: `scanDealStageStaleAutomations(prisma, enqueue): Promise<number>` — mesma assinatura de `scanCustomerInactiveAutomations`. Task 9 consome esse nome para conectar ao `main.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('scanDealStageStaleAutomations', () => {
  function buildPrisma() {
    return {
      automation: { findMany: jest.fn() },
      deal: { findMany: jest.fn() },
      automationRun: { findFirst: jest.fn() },
    };
  }

  it('enfileira um job por deal AT_RISK de uma automação habilitada', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-1', organizationId: 'org-1', conditions: {} },
    ]);
    const staleDeal = {
      id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION',
      stageEnteredAt: new Date('2000-01-01'),
    };
    prisma.deal.findMany.mockResolvedValue([staleDeal]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trigger: 'DEAL_STAGE_STALE', enabled: true } }),
    );
    expect(prisma.deal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', stage: { notIn: ['WON', 'LOST'] } }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith({
      organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM',
    });
    expect(count).toBe(1);
  });

  it('não enfileira um deal cujo bucket ainda é ON_TRACK ou COOLING', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    prisma.deal.findMany.mockResolvedValue([
      { id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION', stageEnteredAt: new Date() },
    ]);
    const enqueue = jest.fn();

    const count = await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('usa conditions.thresholdHoursOverride em vez do default quando configurado', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-1', organizationId: 'org-1', conditions: { thresholdHoursOverride: 1 } },
    ]);
    const stageEnteredAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h atrás
    prisma.deal.findMany.mockResolvedValue([
      { id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION', stageEnteredAt },
    ]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(enqueue).toHaveBeenCalled();
    expect(count).toBe(1);
  });

  it('não enfileira de novo um deal já tratado com sucesso desde a última mudança de etapa (dedup)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    const staleDeal = { id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION', stageEnteredAt: new Date('2000-01-01') };
    prisma.deal.findMany.mockResolvedValue([staleDeal]);
    prisma.automationRun.findFirst.mockResolvedValue({ id: 'run-1' });
    const enqueue = jest.fn();

    const count = await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(prisma.automationRun.findFirst).toHaveBeenCalledWith({
      where: { automationId: 'auto-1', dealId: 'deal-1', status: 'SUCCESS', createdAt: { gt: staleDeal.stageEnteredAt } },
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter worker test -- automation-scan.spec`
Expected: FAIL — `scanDealStageStaleAutomations is not a function` (ou `is not exported`).

- [ ] **Step 3: Implementar `scanDealStageStaleAutomations`**

```ts
import { computeDealRisk, DEFAULT_EXPECTED_STAGE_DURATION_HOURS, type DealStage } from '@opsmind/shared-types';

const CLOSED_DEAL_STAGES: DealStage[] = ['WON', 'LOST'];

interface DealStageStaleConditions {
  thresholdHoursOverride?: number;
}

export async function scanDealStageStaleAutomations(
  prisma: PrismaClient,
  enqueue: (data: AutomationExecutionJobData) => Promise<unknown> | void,
): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { trigger: 'DEAL_STAGE_STALE', enabled: true },
  });
  let enqueuedCount = 0;
  const now = new Date();

  for (const automation of automations) {
    const conditions = automation.conditions as DealStageStaleConditions;
    const openDeals = await prisma.deal.findMany({
      where: { organizationId: automation.organizationId, deletedAt: null, stage: { notIn: CLOSED_DEAL_STAGES } },
    });

    for (const deal of openDeals) {
      const expectedHours = conditions.thresholdHoursOverride !== undefined
        ? { ...DEFAULT_EXPECTED_STAGE_DURATION_HOURS, [deal.stage]: conditions.thresholdHoursOverride }
        : DEFAULT_EXPECTED_STAGE_DURATION_HOURS;
      if (computeDealRisk(deal, now, expectedHours) !== 'AT_RISK') continue;

      const alreadyHandled = await prisma.automationRun.findFirst({
        where: { automationId: automation.id, dealId: deal.id, status: 'SUCCESS', createdAt: { gt: deal.stageEnteredAt } },
      });
      if (alreadyHandled) continue;

      await enqueue({
        organizationId: automation.organizationId, automationId: automation.id,
        customerId: deal.customerId, dealId: deal.id, actorType: 'SYSTEM',
      });
      enqueuedCount += 1;
    }
  }
  return enqueuedCount;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter worker test -- automation-scan.spec`
Expected: PASS, incluindo os testes pré-existentes de `scanCustomerInactiveAutomations`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/automation-scan.ts apps/worker/src/automation-scan.spec.ts
git commit -m "feat(worker): scan do trigger DEAL_STAGE_STALE"
```

---

### Task 7: Worker — scan de `DEAL_SILENT_FOR`

**Files:**
- Modify: `apps/worker/src/automation-scan.ts`
- Modify: `apps/worker/src/automation-scan.spec.ts`

**Interfaces:**
- Consumes: `AutomationTrigger.DEAL_SILENT_FOR`, `AutomationExecutionJobData.dealId` (Task 2); `CLOSED_DEAL_STAGES` (definido na Task 6, mesmo arquivo).
- Produces: `scanDealSilentForAutomations(prisma, enqueue): Promise<number>`. Task 9 consome esse nome.

**Ruling deste plano** (desvio intencional do texto literal do design doc): o design doc generaliza o dedup dos dois triggers novos como `createdAt > deal.stageEnteredAt`. Para `DEAL_STAGE_STALE` isso é exatamente certo (reseta quando a etapa muda). Para `DEAL_SILENT_FOR`, usar `stageEnteredAt` reabriria a automação só quando a etapa muda — nunca quando o cliente tem uma atividade nova e depois volta a ficar quieto, que é a própria causa raiz deste trigger. Este plano usa `createdAt > customer.lastActivityAt` para o dedup de `DEAL_SILENT_FOR` (mesmo sinal de reset que `CUSTOMER_INACTIVE` já usa). Custo se essa leitura estiver errada: um reviewer que prefira seguir o texto literal do doc pede a troca de uma linha (o campo do `where` de dedup) — baixo.

- [ ] **Step 1: Write the failing tests**

```ts
describe('scanDealSilentForAutomations', () => {
  function buildPrisma() {
    return {
      automation: { findMany: jest.fn() },
      deal: { findMany: jest.fn() },
      automationRun: { findFirst: jest.fn() },
    };
  }

  it('enfileira um job por deal aberto cujo cliente está quieto há mais que o limiar', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    const lastActivityAt = new Date('2000-01-01');
    prisma.deal.findMany.mockResolvedValue([
      { id: 'deal-1', customerId: 'cust-1', stage: 'NEGOTIATION', customer: { lastActivityAt } },
    ]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanDealSilentForAutomations(prisma as never, enqueue);

    expect(prisma.deal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          stage: { notIn: ['WON', 'LOST'] },
          customer: { lastActivityAt: { lt: expect.any(Date) } },
        }),
        include: { customer: true },
      }),
    );
    expect(enqueue).toHaveBeenCalledWith({
      organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM',
    });
    expect(count).toBe(1);
  });

  it('usa conditions.silentForDays em vez do default (7 dias) quando configurado', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-1', organizationId: 'org-1', conditions: { silentForDays: 30 } },
    ]);
    prisma.deal.findMany.mockResolvedValue([]);

    await scanDealSilentForAutomations(prisma as never, jest.fn());

    const cutoffUsed = prisma.deal.findMany.mock.calls[0][0].where.customer.lastActivityAt.lt as Date;
    const expectedCutoff = new Date();
    expectedCutoff.setDate(expectedCutoff.getDate() - 30);
    expect(Math.abs(cutoffUsed.getTime() - expectedCutoff.getTime())).toBeLessThan(5000);
  });

  it('não enfileira de novo um deal já tratado com sucesso desde a última atividade do cliente (dedup)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    const lastActivityAt = new Date('2000-01-01');
    prisma.deal.findMany.mockResolvedValue([
      { id: 'deal-1', customerId: 'cust-1', stage: 'NEGOTIATION', customer: { lastActivityAt } },
    ]);
    prisma.automationRun.findFirst.mockResolvedValue({ id: 'run-1' });
    const enqueue = jest.fn();

    const count = await scanDealSilentForAutomations(prisma as never, enqueue);

    expect(prisma.automationRun.findFirst).toHaveBeenCalledWith({
      where: { automationId: 'auto-1', dealId: 'deal-1', status: 'SUCCESS', createdAt: { gt: lastActivityAt } },
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter worker test -- automation-scan.spec`
Expected: FAIL — `scanDealSilentForAutomations is not a function`.

- [ ] **Step 3: Implementar `scanDealSilentForAutomations`**

```ts
interface DealSilentForConditions {
  silentForDays?: number;
}
const DEFAULT_SILENT_FOR_DAYS = 7;

export async function scanDealSilentForAutomations(
  prisma: PrismaClient,
  enqueue: (data: AutomationExecutionJobData) => Promise<unknown> | void,
): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { trigger: 'DEAL_SILENT_FOR', enabled: true },
  });
  let enqueuedCount = 0;

  for (const automation of automations) {
    const conditions = automation.conditions as DealSilentForConditions;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (conditions.silentForDays ?? DEFAULT_SILENT_FOR_DAYS));

    const silentDeals = await prisma.deal.findMany({
      where: {
        organizationId: automation.organizationId, deletedAt: null,
        stage: { notIn: CLOSED_DEAL_STAGES }, customer: { lastActivityAt: { lt: cutoff } },
      },
      include: { customer: true },
    });

    for (const deal of silentDeals) {
      const alreadyHandled = await prisma.automationRun.findFirst({
        where: { automationId: automation.id, dealId: deal.id, status: 'SUCCESS', createdAt: { gt: deal.customer.lastActivityAt! } },
      });
      if (alreadyHandled) continue;

      await enqueue({
        organizationId: automation.organizationId, automationId: automation.id,
        customerId: deal.customerId, dealId: deal.id, actorType: 'SYSTEM',
      });
      enqueuedCount += 1;
    }
  }
  return enqueuedCount;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter worker test -- automation-scan.spec`
Expected: PASS, incluindo todos os testes pré-existentes e os da Task 6.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/automation-scan.ts apps/worker/src/automation-scan.spec.ts
git commit -m "feat(worker): scan do trigger DEAL_SILENT_FOR"
```

---

### Task 8: Worker — `processAutomationJob` executa os dois triggers novos

**Files:**
- Modify: `apps/worker/src/automation-processor.ts`
- Modify: `apps/worker/src/automation-processor.spec.ts`

**Interfaces:**
- Consumes: `computeDealRisk`, `DEFAULT_EXPECTED_STAGE_DURATION_HOURS` (Task 1); `AutomationExecutionJobData.dealId`, `AutomationRun.dealId` (Task 2); mesmo dedup/condições usados pelos scans das Tasks 6/7 (reconfirmados aqui no momento da execução, nunca confiando cegamente no scan — mesmo princípio já aplicado a `CUSTOMER_INACTIVE`).
- Produces: nada consumido por task posterior (última peça de execução do motor).

- [ ] **Step 1: Write the failing tests**

```ts
describe('processAutomationJob — DEAL_STAGE_STALE', () => {
  const jobData = { organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM' as const };
  const staleAutomation = { id: 'auto-1', organizationId: 'org-1', trigger: 'DEAL_STAGE_STALE', conditions: {}, actions: { createTask: true, notify: true } };
  const staleDeal = { id: 'deal-1', customerId: 'cust-1', title: 'Contrato X', stage: 'QUALIFICATION', stageEnteredAt: new Date('2000-01-01'), ownerUserId: 'user-owner' };
  const customer = { id: 'cust-1', name: 'Acme' };

  function buildTx() {
    return {
      automation: { findFirst: jest.fn() }, deal: { findFirst: jest.fn() }, customer: { findFirst: jest.fn() },
      task: { create: jest.fn() }, notification: { create: jest.fn() }, auditLog: { create: jest.fn() }, automationRun: { create: jest.fn() },
    };
  }

  it('cria task + notificação e registra AutomationRun SUCCESS com dealId quando o deal ainda está AT_RISK', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(staleAutomation);
    tx.deal.findFirst.mockResolvedValue(staleDeal);
    tx.customer.findFirst.mockResolvedValue(customer);
    tx.task.create.mockResolvedValue({ id: 'task-1' });
    tx.notification.create.mockResolvedValue({ id: 'notif-1' });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SUCCESS' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-1', customerId: 'cust-1', actorType: 'AUTOMATION', actorId: 'auto-1' }),
    });
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-owner', type: 'automation.deal_stage_stale' }),
    });
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dealId: 'deal-1', customerId: 'cust-1', status: 'SUCCESS' }),
    });
  });

  it('marca SKIPPED sem criar task quando o deal já não está mais AT_RISK (mudou de etapa entre o scan e a execução)', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(staleAutomation);
    tx.deal.findFirst.mockResolvedValue({ ...staleDeal, stageEnteredAt: new Date() });
    tx.customer.findFirst.mockResolvedValue(customer);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'SKIPPED' }) });
  });

  it('pula a notificação (sem falhar) quando o deal não tem ownerUserId', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(staleAutomation);
    tx.deal.findFirst.mockResolvedValue({ ...staleDeal, ownerUserId: null });
    tx.customer.findFirst.mockResolvedValue(customer);
    tx.task.create.mockResolvedValue({ id: 'task-1' });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SUCCESS' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});

describe('processAutomationJob — DEAL_SILENT_FOR', () => {
  const jobData = { organizationId: 'org-1', automationId: 'auto-2', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM' as const };
  const silentAutomation = { id: 'auto-2', organizationId: 'org-1', trigger: 'DEAL_SILENT_FOR', conditions: {}, actions: { createTask: true, notify: false } };
  const silentDeal = { id: 'deal-1', customerId: 'cust-1', title: 'Contrato Y', stage: 'NEGOTIATION', ownerUserId: null };

  function buildTx() {
    return {
      automation: { findFirst: jest.fn() }, deal: { findFirst: jest.fn() }, customer: { findFirst: jest.fn() },
      task: { create: jest.fn() }, notification: { create: jest.fn() }, auditLog: { create: jest.fn() }, automationRun: { create: jest.fn() },
    };
  }

  it('cria task quando o cliente do deal ainda está quieto há mais que o limiar', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(silentAutomation);
    tx.deal.findFirst.mockResolvedValue(silentDeal);
    tx.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Beta', lastActivityAt: new Date('2000-01-01') });
    tx.task.create.mockResolvedValue({ id: 'task-1' });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SUCCESS' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).toHaveBeenCalled();
  });

  it('marca SKIPPED quando o cliente teve atividade nova desde o agendamento do job', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(silentAutomation);
    tx.deal.findFirst.mockResolvedValue(silentDeal);
    tx.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Beta', lastActivityAt: new Date() });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter worker test -- automation-processor.spec`
Expected: FAIL — os novos casos devolvem o comportamento do caminho `CUSTOMER_INACTIVE` (que ignora `dealId`) em vez do esperado, ou lançam por `tx.deal` não existir no mock quando o código ainda não busca o deal.

- [ ] **Step 3: Implementar**

Em `automation-processor.ts`, depois de confirmar que a automação existe e está habilitada, ramificar em `switch (automation.trigger)`. Mover o bloco `CUSTOMER_INACTIVE` existente para o case correspondente (comportamento idêntico, sem mudança). Adicionar os dois cases novos, cada um:
1. Se `!data.dealId`, `automationRun.create` com `status: 'SKIPPED'`, `result: { reason: 'dealId ausente no job' }`.
2. `tx.deal.findFirst({ where: { id: data.dealId, organizationId: data.organizationId, deletedAt: null } })` — se `null`, SKIPPED "Negócio não encontrado ou excluído".
3. `tx.customer.findFirst({ where: { id: deal.customerId, organizationId: data.organizationId, deletedAt: null } })` — se `null`, SKIPPED "Cliente do negócio não encontrado ou excluído".
4. Reconfirmar a condição: `DEAL_STAGE_STALE` recalcula `computeDealRisk` (mesmo cálculo de override da Task 6) e exige `AT_RISK`; `DEAL_SILENT_FOR` recalcula o cutoff a partir de `conditions.silentForDays ?? DEFAULT_SILENT_FOR_DAYS` (mesma constante local da Task 7) e exige `customer.lastActivityAt !== null && customer.lastActivityAt < cutoff`. Se a condição não bate mais, SKIPPED "Condição não bate mais desde o agendamento do job".
5. `actions.createTask` → `tx.task.create` com `customerId: deal.customerId`, `actorType: 'AUTOMATION'`, `actorId: automation.id`, título `` `Reativar negócio "${deal.title}"` ``, descrição determinística citando o nome da etapa (`DEAL_STAGE_STALE`) ou os dias sem atividade (`DEAL_SILENT_FOR`) — sem IA, mesma regra do design (Non-goal).
6. `actions.notify && deal.ownerUserId` → `tx.notification.create` com `userId: deal.ownerUserId`, `type: 'automation.deal_stage_stale'` ou `'automation.deal_silent_for'`, `payload: { dealId: deal.id, dealTitle: deal.title, automationId: automation.id }`.
7. `auditLog.create` + `automationRun.create` com `status: 'SUCCESS'`, `dealId: deal.id`, `customerId: deal.customerId`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter worker test -- automation-processor.spec`
Expected: PASS, incluindo todos os testes pré-existentes de `CUSTOMER_INACTIVE`.

- [ ] **Step 5: Run the whole worker suite and commit**

Run: `pnpm --filter worker test`
Expected: PASS, nenhuma regressão.

```bash
git add apps/worker/src/automation-processor.ts apps/worker/src/automation-processor.spec.ts
git commit -m "feat(worker): processa execuções dos triggers DEAL_STAGE_STALE e DEAL_SILENT_FOR"
```

---

### Task 9: Worker — conectar os dois scans novos ao `main.ts`

**Files:**
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: `scanDealStageStaleAutomations` (Task 6), `scanDealSilentForAutomations` (Task 7).

Sem teste automatizado (não existe arquivo de teste para `main.ts` no projeto) — verificado por typecheck/build e por inspeção do código.

- [ ] **Step 1: Importar as duas funções novas**

Adicionar ao bloco de imports de `automation-scan`: `scanCustomerInactiveAutomations, scanDealStageStaleAutomations, scanDealSilentForAutomations`.

- [ ] **Step 2: Adicionar uma função de scan e conectá-la ao mesmo intervalo**

Ao lado de `runScan`/`setInterval(runScan, SCAN_INTERVAL_MS)` já existentes, adicionar:

```ts
async function runDealAutomationsScan(): Promise<void> {
  try {
    const staleCount = await scanDealStageStaleAutomations(prisma, (data) => queue.add('execute', data));
    const silentCount = await scanDealSilentForAutomations(prisma, (data) => queue.add('execute', data));
    const enqueued = staleCount + silentCount;
    if (enqueued > 0) {
      logger.info({ enqueued }, 'scan de automações de deal enfileirou execuções');
    }
  } catch (error) {
    logger.error({ err: error }, 'scan de automações de deal falhou');
    Sentry.captureException(error);
  }
}

await runDealAutomationsScan();
setInterval(runDealAutomationsScan, SCAN_INTERVAL_MS);
```

(Mesma fila `queue`/`SCAN_INTERVAL_MS` já em uso por `runScan` — nenhuma fila ou intervalo novo.)

- [ ] **Step 3: Typecheck e build**

Run: `pnpm --filter worker run build`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/main.ts
git commit -m "feat(worker): liga os scans de DEAL_STAGE_STALE/DEAL_SILENT_FOR ao loop do worker"
```

---

### Task 10: Web — Kanban arrastável

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/lib/deals/use-deals.ts`
- Modify: `apps/web/app/organizations/[organizationId]/deals/page.tsx`

**Interfaces:**
- Consumes: `DEAL_STAGE_TRANSITIONS`, `MoveDealStageInput` (já existentes em `apps/web/lib/deals/types.ts`); endpoint `POST .../deals/:dealId/move-stage` (já existente, `DealsService.moveStage`, Task 2 em diante só adicionou `stageEnteredAt` ao lado do servidor — sem mudança de contrato).

Sem suíte de teste automatizado no `apps/web` — verificação manual (mesma convenção da Task 4).

Ruling deste plano: o `<Select>` de "Mover para…" dentro de cada `DealCard` é **removido** nesta task — o design já descreve o drag como a substituição da UX do Select ("a diferença de UX mais perceptível"), manter os dois ao mesmo tempo seria redundante. A tela de detalhe do Deal (`apps/web/app/organizations/[organizationId]/deals/[dealId]/page.tsx`) continua com seu próprio controle de mudança de etapa, intocada — fora do escopo desta task.

- [ ] **Step 1: Instalar a dependência**

Run: `cd apps/web && pnpm info @hello-pangea/dnd version` (confirmar a versão estável atual antes de fixar) `&& pnpm add @hello-pangea/dnd@<versão confirmada>`
Expected: instala sem conflito de peer dependency com o React 18 já usado pelo projeto.

- [ ] **Step 2: Novo hook `useMoveDealStageForDeal`**

Em `apps/web/lib/deals/use-deals.ts`, adicionar (sem alterar `useMoveDealStage`, usado por `[dealId]/page.tsx`):

```ts
export function useMoveDealStageForDeal(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, input }: { dealId: string; input: MoveDealStageInput }) =>
      apiFetch<Deal>(`/organizations/${organizationId}/deals/${dealId}/move-stage`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals'] });
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'dashboard'] });
    },
  });
}
```

- [ ] **Step 3: Remover o `<Select>` do `DealCard`; envolver as colunas em `DragDropContext`**

Em `page.tsx`:
- `DealCard` perde a chamada a `useMoveDealStage` e todo o bloco `{canWrite && nextStages.length > 0 && (<Select>...)}`.
- A grade de colunas (`DEAL_STAGES.map(...)`) passa a ficar dentro de `<DragDropContext onDragEnd={onDragEnd}>`; cada coluna vira `<Droppable droppableId={stage}>` (envolvendo a lista de cards com `provided.innerRef`/`{...provided.droppableProps}` e `{provided.placeholder}`); cada `DealCard` é renderizado dentro de `<Draggable draggableId={deal.id} index={index} isDragDisabled={!canWrite}>`.
- `onDragEnd(result)`: se `!result.destination` ou `result.destination.droppableId === result.source.droppableId`, retornar sem fazer nada. Senão, validar `DEAL_STAGE_TRANSITIONS[source.droppableId as DealStage].includes(destination.droppableId as DealStage)` — se inválido, retornar sem chamar a mutation (o card volta visualmente à posição original porque a lista subjacente não muda). Se o destino for `'LOST'`, `window.prompt` pelo motivo — sem motivo informado, retornar sem chamar a mutation. Caso válido, `moveStageForDeal.mutate({ dealId: result.draggableId, input: { stage: destination.droppableId as DealStage, ...(destino === 'LOST' ? { lostReason } : {}) } })`.

- [ ] **Step 4: Rodar o dev server e verificar manualmente**

Run: `pnpm --filter web dev`
Expected:
- Arrastar um card para uma coluna válida move o deal de etapa (confirmar na UI após o refetch).
- Arrastar para uma coluna cujo destino não está em `DEAL_STAGE_TRANSITIONS` não chama a API (checar a aba de rede) e o card continua na coluna original.
- Arrastar para `LOST` abre o prompt de motivo; cancelar o prompt não chama a API; confirmar com motivo chama a API com `lostReason`.
- Um membro `VIEWER` (ou qualquer role fora de `WRITE_ROLES`) não consegue arrastar nenhum card.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/lib/deals/use-deals.ts "apps/web/app/organizations/[organizationId]/deals/page.tsx"
git commit -m "feat(web): Kanban de Deals arrastável (@hello-pangea/dnd), substitui o Select de mudança de etapa"
```
