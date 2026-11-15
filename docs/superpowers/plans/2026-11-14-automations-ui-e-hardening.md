# Automations: UI de gerenciamento + hardening do motor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao motor de Automations (3 triggers reais: `CUSTOMER_INACTIVE`, `DEAL_STAGE_STALE`,
`DEAL_SILENT_FOR`) uma superfície de usuário real — criar, editar, ativar/desativar, ver histórico e
disparar manualmente, tudo hoje só acessível via HTTP direto — e fechar duas lacunas de arquitetura na fila
BullMQ que o sustenta, mais 3 itens de maior valor de um backlog de achados já conhecidos.

**Architecture:** Backend ganha `update` (PATCH) em `AutomationsService`/`AutomationsController`, seguindo
o mesmo padrão de auditoria/validação já usado por `ProspectingTargetsService`. Frontend ganha uma tela nova
em `apps/web/app/organizations/[organizationId]/automations`, seguindo ponto a ponto o único CRUD completo
já existente no app (`prospecting-targets`). A fila `automation-execution` ganha um `jobId` de dedup
derivado em `packages/shared-types` (único lugar que os dois produtores — `apps/api` e `apps/worker` — podem
compartilhar código) e `defaultJobOptions` de limpeza. Um dedup inconsistente em `DEAL_SILENT_FOR` e 3 itens
de teste/comportamento do processor são corrigidos no mesmo worker.

**Tech Stack:** NestJS (`apps/api`), BullMQ worker (`apps/worker`), Next.js 14 App Router (`apps/web`),
react-hook-form + zod, TanStack Query, Prisma/Postgres.

**Spec:** `/Users/pam/.claude/plans/nos-estamos-usando-o-mighty-planet.md` (plano aprovado pelo usuário via
Plan Mode do harness — Context, decisões de "como", e seção "Fora desta sprint" são a autoridade vinculante
deste plano).

## Global Constraints

- **Sem endpoint `DELETE` de Automation nesta sprint** — `Automation` não tem `deletedAt` e
  `AutomationRun.automation` tem `onDelete: Cascade`; apagar perderia o histórico de execução, contra PRD
  §8 ("automações são auditáveis como qualquer ação humana"). "Desligar" é `enabled: false` via PATCH.
- **`runNow` continua só suportando `trigger === 'CUSTOMER_INACTIVE'`** (já lança `BadRequestException` pros
  outros dois) — a UI reflete essa limitação (botão desabilitado + tooltip), nunca a esconde.
- **Reusar componentes existentes**: `Dialog` para o histórico (não introduzir `Sheet`, sem precedente de
  uso no app); checkbox + `Badge` com as chaves `ACTIVE`/`INACTIVE` já existentes pra "habilitada" (não criar
  `Switch`).
- **`jobId`/opções de fila vivem numa função pura em `packages/shared-types`** (API e worker não podem
  importar um do outro) — mesmo espírito de `computeDealRisk`.
- **A API é a autoridade de permissão; a UI só esconde** — `WRITE_ROLES` controla visibilidade de botões,
  mas todo endpoint de escrita já tem `@Roles(...WRITE_ROLES)` + `RolesGuard` independente da UI.
- **Fora de escopo** (não implementar): Fase 9 do PRD, UX de drag do Kanban (feedback de erro/update
  otimista), `Deal.risk` em todas as respostas de Deal, guard de tenant na FK `automation_runs_deal_id_fkey`.

## Review Focus

- Editar uma automação com um valor inválido no único campo numérico de `conditions` (zero, negativo, não-
  inteiro) precisa ser rejeitado com 400, tanto no `create` quanto no `update` — senão uma automação mal
  configurada passa a gerar reativação a cada ciclo de scan (Tasks 1).
- `VIEWER` não pode editar/ativar/desativar/disparar uma automação pela UI, e a API rejeita com 403 mesmo
  que a UI falhe em esconder o botão — a autoridade real nunca pode ser só a UI (Tasks 1, 3).
- Dois jobs para o mesmo par (automação, deal/cliente) enfileirados antes do primeiro terminar não podem
  virar duas execuções — é exatamente o cenário que motivou o `jobId` de dedup, e precisa de uma prova real
  contra Redis, não só a asserção de que o argumento foi passado (Task 5).
- Um job de `DEAL_STAGE_STALE`/`DEAL_SILENT_FOR` que falha (bloco `catch` do processor) precisa manter o
  vínculo com o deal no histórico de falha, não só nos de sucesso/skip — senão o histórico de erros de um
  deal específico fica invisível na UI nova (Task 8).
- O formulário de criar/editar (primeiro formulário condicional-por-tipo do app, sem precedente, sem suíte
  de teste de frontend pra pegar isso automaticamente) não pode deixar o campo de condição de um trigger
  anterior sobrando no payload depois de trocar o `<select>` de trigger antes de salvar — ex.: trocar de
  `DEAL_STAGE_STALE` pra `DEAL_SILENT_FOR` não pode submeter `thresholdHoursOverride` junto com
  `silentForDays` (Task 3, verificação manual explícita).

---

### Task 1: Backend — `AutomationsService.update` + validação de range + endpoint PATCH

**Files:**
- Modify: `apps/api/src/modules/automations/automations.service.ts`
- Modify: `apps/api/src/modules/automations/automations.service.spec.ts`
- Create: `apps/api/src/modules/automations/dto/update-automation.dto.ts`
- Modify: `apps/api/src/modules/automations/automations.controller.ts`
- Modify: `apps/api/test/automations.e2e-spec.ts`

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `UpdateAutomationInput { name?: string; conditions?: object; actions?: object; enabled?:
  boolean }`; `AutomationsService.update(organizationId: string, actorUserId: string, automationId: string,
  dto: UpdateAutomationInput): Promise<Automation>`; endpoint `PATCH organizations/:organizationId/
  automations/:automationId`. Tasks 2/3 (frontend) consomem esse endpoint/shape exatamente.

- [ ] **Step 1: Write the failing tests (service)**

Em `automations.service.spec.ts`, adicionar `automation.update: jest.fn()` ao mock de `prisma.automation`
no `beforeEach`, e um novo `describe`:

```ts
describe('update', () => {
  it('atualiza a automação, audita, e não precisa reenviar todos os campos', async () => {
    prisma.automation.findFirst.mockResolvedValue({
      id: 'auto-1', organizationId: 'org-1', trigger: 'CUSTOMER_INACTIVE', conditions: {}, actions: {},
    });
    prisma.automation.update.mockResolvedValue({ id: 'auto-1', organizationId: 'org-1', enabled: false });

    const result = await service.update('org-1', 'user-1', 'auto-1', { enabled: false });

    expect(prisma.automation.update).toHaveBeenCalledWith({ where: { id: 'auto-1' }, data: { enabled: false } });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'USER', actorId: 'user-1', action: 'automation.updated' }),
    );
    expect(result.enabled).toBe(false);
  });

  it('lança NotFoundException se a automação não existe na organização', async () => {
    prisma.automation.findFirst.mockResolvedValue(null);

    await expect(service.update('org-1', 'user-1', 'auto-x', { enabled: false })).rejects.toThrow(NotFoundException);
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });

  it('rejeita thresholdHoursOverride <= 0 num DEAL_STAGE_STALE', async () => {
    prisma.automation.findFirst.mockResolvedValue({
      id: 'auto-1', organizationId: 'org-1', trigger: 'DEAL_STAGE_STALE', conditions: {}, actions: {},
    });

    await expect(
      service.update('org-1', 'user-1', 'auto-1', { conditions: { thresholdHoursOverride: 0 } }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });

  it('rejeita silentForDays não-inteiro num DEAL_SILENT_FOR', async () => {
    prisma.automation.findFirst.mockResolvedValue({
      id: 'auto-1', organizationId: 'org-1', trigger: 'DEAL_SILENT_FOR', conditions: {}, actions: {},
    });

    await expect(
      service.update('org-1', 'user-1', 'auto-1', { conditions: { silentForDays: 2.5 } }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('create — validação de range de conditions', () => {
  it('rejeita inactiveForDays negativo', async () => {
    await expect(
      service.create('org-1', 'user-1', {
        name: 'X', trigger: 'CUSTOMER_INACTIVE', conditions: { inactiveForDays: -1 }, actions: {},
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.automation.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- automations.service.spec`
Expected: FAIL — `service.update is not a function`, e o teste de range de `create` falha porque nada valida
ainda (o `create` existente não rejeita `inactiveForDays: -1`).

- [ ] **Step 3: Implementar `assertValidConditionsRange` + `update` em `automations.service.ts`**

Mapa de módulo (ao lado das interfaces já existentes no topo do arquivo):
`const CONDITION_NUMERIC_FIELD: Record<AutomationTrigger, string> = { CUSTOMER_INACTIVE: 'inactiveForDays',
DEAL_STAGE_STALE: 'thresholdHoursOverride', DEAL_SILENT_FOR: 'silentForDays' };`

Método privado `private assertValidConditionsRange(trigger: AutomationTrigger, conditions:
object | undefined): void` — lê `conditions?.[CONDITION_NUMERIC_FIELD[trigger]]`; se `!== undefined` e
(`!Number.isInteger(value) || value <= 0`), lança `BadRequestException` com uma mensagem citando o nome do
campo. Chamar no início de `create()` (com `dto.trigger`, `dto.conditions`) e no início de `update()`
(precisa do `trigger` da automação já existente, não do `dto` — `trigger` não é editável nesta sprint).

`update(organizationId: string, actorUserId: string, automationId: string, dto: UpdateAutomationInput):
Promise<Automation>`: `findByIdOrThrow` → `assertValidConditionsRange(existing.trigger, dto.conditions)` →
`prisma.automation.update({ where: { id: automationId }, data: dto })` → `auditService.log({ actorType:
'USER', actorId: actorUserId, organizationId, action: 'automation.updated', resource:
\`Automation:${automationId}\`, metadata: { ...dto } })` → retorna o resultado. `trigger` nunca aceito em
`UpdateAutomationInput` (editar o tipo da automação não é suportado).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- automations.service.spec`
Expected: PASS, incluindo os testes pré-existentes de `create`/`list`/`runNow`.

- [ ] **Step 5: Write the failing DTO/controller + e2e, then implement**

`apps/api/src/modules/automations/dto/update-automation.dto.ts` (campos opcionais redeclarados, mesmo
estilo de `update-prospecting-target.dto.ts` — não `PartialType`):

```ts
import { IsBoolean, IsObject, IsOptional, MaxLength, MinLength } from 'class-validator';

export class UpdateAutomationDto {
  @IsOptional() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsObject() conditions?: object;
  @IsOptional() @IsObject() actions?: object;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
```

Em `automations.controller.ts`, adicionar:

```ts
@Roles(...WRITE_ROLES)
@UseGuards(RolesGuard)
@Patch(':automationId')
update(
  @Param('organizationId') organizationId: string,
  @Param('automationId') automationId: string,
  @CurrentUser() user: { id: string },
  @Body() dto: UpdateAutomationDto,
): Promise<Automation> {
  return this.automationsService.update(organizationId, user.id, automationId, dto);
}
```

Em `apps/api/test/automations.e2e-spec.ts`, adicionar (mesmo padrão de setup do arquivo — organização/
membership/automação já criadas num `beforeEach`/helper existente):

```ts
it('PATCH /automations/:id atualiza e audita', async () => {
  const created = await request(app.getHttpServer())
    .post(`/organizations/${organization.id}/automations`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'X', trigger: 'CUSTOMER_INACTIVE', actions: { createTask: true } });

  const response = await request(app.getHttpServer())
    .patch(`/organizations/${organization.id}/automations/${created.body.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ enabled: false });

  expect(response.status).toBe(200);
  expect(response.body.enabled).toBe(false);
});

it('PATCH /automations/:id — VIEWER recebe 403', async () => {
  // reusar o padrão de token de VIEWER já usado no teste de POST .../run existente no arquivo
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter api test -- automations.service.spec` e `pnpm --filter api test:e2e -- automations.e2e-spec`
(precisa Postgres+Redis up).
Expected: PASS.

- [ ] **Step 7: Run full API suite and commit**

Run: `pnpm --filter api test`
Expected: PASS, nenhuma regressão.

```bash
git add apps/api/src/modules/automations apps/api/test/automations.e2e-spec.ts
git commit -m "feat(api): Automations ganha update (PATCH) com validação de range de conditions"
```

---

### Task 2: Frontend — tipos e hooks de Automations

**Files:**
- Create: `apps/web/lib/automations/types.ts`
- Create: `apps/web/lib/automations/use-automations.ts`

**Interfaces:**
- Consumes: endpoints `POST/GET/PATCH organizations/:organizationId/automations[/:automationId]`, `GET
  .../:automationId/runs`, `POST .../:automationId/run` (Task 1 para o PATCH; os demais já existem).
- Produces: `Automation`, `AutomationRun`, `AutomationTrigger`, `CreateAutomationInput`,
  `UpdateAutomationInput`, `AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string>`,
  `AUTOMATION_CONDITION_FIELD: Record<AutomationTrigger, { key: string; label: string; unit: string }>`,
  `WRITE_ROLES` (duplicado, mesmo padrão de todo `lib/<domain>/types.ts`). `useAutomations`,
  `useCreateAutomation`, `useUpdateAutomation`, `useAutomationRuns`, `useRunAutomationNow`. Task 3 consome
  esses nomes exatamente.

Sem suíte de teste automatizada em `apps/web` (confirmado em sessão anterior) — verificação por typecheck.

- [ ] **Step 1: `types.ts`**

```ts
import type { Role } from '@opsmind/shared-types';

export const WRITE_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];

export type AutomationTrigger = 'CUSTOMER_INACTIVE' | 'DEAL_STAGE_STALE' | 'DEAL_SILENT_FOR';
export type AutomationRunStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  CUSTOMER_INACTIVE: 'Cliente inativo',
  DEAL_STAGE_STALE: 'Negócio parado na etapa',
  DEAL_SILENT_FOR: 'Cliente sem atividade (negócio)',
};

export const AUTOMATION_CONDITION_FIELD: Record<AutomationTrigger, { key: string; label: string; unit: string }> = {
  CUSTOMER_INACTIVE: { key: 'inactiveForDays', label: 'Dias sem atividade', unit: 'dias' },
  DEAL_STAGE_STALE: { key: 'thresholdHoursOverride', label: 'Horas na etapa', unit: 'horas' },
  DEAL_SILENT_FOR: { key: 'silentForDays', label: 'Dias sem atividade do cliente', unit: 'dias' },
};

export interface Automation {
  id: string;
  organizationId: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: Record<string, unknown>;
  actions: { createTask?: boolean; notify?: boolean };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  customerId: string | null;
  dealId: string | null;
  status: AutomationRunStatus;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface CreateAutomationInput {
  name: string;
  trigger: AutomationTrigger;
  conditions?: Record<string, unknown>;
  actions: { createTask?: boolean; notify?: boolean };
  enabled?: boolean;
}

export type UpdateAutomationInput = Partial<Omit<CreateAutomationInput, 'trigger'>>;
```

- [ ] **Step 2: `use-automations.ts`**

Mesmo padrão de `apps/web/lib/leads/use-prospecting-targets.ts` (`apiFetch`, `useQueryClient`,
`invalidateQueries` na query key `['organizations', organizationId, 'automations']`):

```ts
export function useAutomations(organizationId: string) { /* useQuery, GET .../automations */ }
export function useCreateAutomation(organizationId: string) { /* useMutation POST, invalida lista */ }
export function useUpdateAutomation(organizationId: string) {
  /* useMutation PATCH; mutationFn: ({ automationId, input }: { automationId: string; input: UpdateAutomationInput }) => ... */
}
export function useAutomationRuns(organizationId: string, automationId: string) {
  /* useQuery, GET .../:automationId/runs, query key ['organizations', organizationId, 'automations', automationId, 'runs'], enabled: !!automationId */
}
export function useRunAutomationNow(organizationId: string) {
  /* useMutation; mutationFn: (automationId: string) => POST .../:automationId/run; SEM invalidateQueries (nada no registro muda, mesmo padrão de useRunProspectingTargetNow) */
}
```

- [ ] **Step 3: Typecheck e commit**

Run: `pnpm --filter web run typecheck`
Expected: sem erro (nada ainda consome esses hooks, só precisa compilar).

```bash
git add apps/web/lib/automations
git commit -m "feat(web): tipos e hooks de Automations"
```

---

### Task 3: Frontend — tela de gerenciamento de Automations

**Files:**
- Create: `apps/web/app/organizations/[organizationId]/automations/page.tsx`
- Modify: `apps/web/lib/nav-items.ts`
- Modify: `apps/web/components/ui/badge.tsx` (novas entradas em `COLORS`: as 3 chaves de `AutomationTrigger`
  — já cobertas pelas chaves `ACTIVE`/`INACTIVE` existentes para o status — e `SUCCESS`/`FAILED`/`SKIPPED`
  pro histórico, se ainda não existirem; `FAILED` pode reusar a cor já mapeada de `DISQUALIFIED`/`REJECTED`,
  `SKIPPED` a de `INACTIVE`, `SUCCESS` a de `ACTIVE` — mesmo espírito de reaproveitamento de cor já usado no
  arquivo entre enums diferentes).

**Interfaces:**
- Consumes: tudo de `apps/web/lib/automations/{types.ts,use-automations.ts}` (Task 2).

Sem suíte de teste automatizada — verificação manual + typecheck.

- [ ] **Step 1: `page.tsx`**

Estrutura, copiando `apps/web/app/organizations/[organizationId]/prospecting-targets/page.tsx`:
- `useCurrentMembership` + `canWrite = membership ? WRITE_ROLES.includes(membership.role) : false`.
- Tabela (`@/components/ui/table`): colunas Nome, Trigger (`<Badge value={a.trigger} />` — adicionar
  entradas de cor pro trigger em `badge.tsx` se ainda não houver, mesmo padrão de `DealRiskBucket`),
  Status (`<Badge value={a.enabled ? 'ACTIVE' : 'INACTIVE'} />`), Criada em, Ações.
- Coluna Ações (só quando `canWrite`): `DropdownMenu` com "Editar" (abre o Dialog em modo edição,
  `reset(automation)` nos `defaultValues`), "Ativar"/"Desativar" (`updateAutomation.mutate({ automationId,
  input: { enabled: !automation.enabled } })` direto, sem abrir o Dialog), "Executar agora"
  (`isDisabled={automation.trigger !== 'CUSTOMER_INACTIVE' || !automation.enabled}`, com `title=` explicando
  o motivo quando desabilitado — reflete a limitação real de `runNow`, não escondida; chama
  `runAutomationNow.mutate(automation.id)` de `useRunAutomationNow(organizationId)`), "Ver histórico" (abre
  o segundo Dialog, dispara `useAutomationRuns(organizationId, automation.id)`).
- Dialog de criar/editar: um único componente reaproveitado (`editingAutomation ? updateAutomation :
  createAutomation`, mesmo padrão de `prospecting-targets`). Campos: `name` (Input), `trigger` (`<Select>`,
  `disabled` quando `editingAutomation` — trocar o trigger de uma automação existente não é suportado).
  Campo de condição único via `watch('trigger')`: `const field = AUTOMATION_CONDITION_FIELD[watchedTrigger];
  <Input type="number" placeholder={field.label} {...register(field.key)} />` — primeiro uso de
  `watch`/formulário condicional-por-tipo no app; comentar o porquê (sem precedente a citar). Dois
  checkboxes compartilhados entre os 3 triggers: `createTask`, `notify`. Checkbox `enabled` (default `true`
  ao criar).
- Dialog de histórico: tabela simples com `AutomationRun[]` — `<Badge value={run.status} />` (adicionar
  `SUCCESS`/`FAILED`/`SKIPPED` ao mapa de cores de `badge.tsx` se ainda não houver), data, e
  `run.errorMessage ?? JSON.stringify(run.result)` resumido numa célula.

- [ ] **Step 2: Nav item**

Em `apps/web/lib/nav-items.ts`, adicionar ao array `NAV_ITEMS` (depois de "Tarefas", mesmo grupo
`workspace`, ícone `Zap` de `lucide-react`): `{ label: 'Automações', segment: 'automations', icon: Zap,
group: 'workspace' }` — sem `roles` (leitura aberta a todo membro no backend).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web run typecheck`
Expected: sem erro.

- [ ] **Step 4: Verificação manual**

Run: `pnpm --filter web dev` (+ api/worker up).
Expected: criar uma automação de cada trigger; editar o campo de condição e o `enabled`; alternar ativo/
inativo pelo dropdown; abrir histórico (vazio no início); disparar "Executar agora" numa `CUSTOMER_INACTIVE`
habilitada e confirmar nova linha em histórico depois; confirmar botão desabilitado nos outros 2 triggers;
logar como `VIEWER` e confirmar que nenhuma ação de escrita aparece. **Caso específico do Review Focus**:
no Dialog de criar, escolher `DEAL_STAGE_STALE` e preencher o campo de condição, depois trocar o `<select>`
pra `DEAL_SILENT_FOR` antes de salvar — confirmar (inspecionar o payload via aba de rede do browser) que o
corpo enviado tem só `silentForDays`, nunca `thresholdHoursOverride` sobrando do trigger anterior.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/organizations/[organizationId]/automations" apps/web/lib/nav-items.ts apps/web/components/ui/badge.tsx
git commit -m "feat(web): tela de gerenciamento de Automations"
```

---

### Task 4: `automationJobId` — função pura de dedup em shared-types

**Files:**
- Modify: `packages/shared-types/src/automation.types.ts`
- Create: `packages/shared-types/src/automation.types.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `automationJobId(data: AutomationExecutionJobData): string`. Task 5 consome este nome.

- [ ] **Step 1: Write the failing tests**

```ts
import { automationJobId } from './automation.types';

describe('automationJobId', () => {
  it('usa automationId + dealId quando dealId está presente', () => {
    const id = automationJobId({
      organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1',
      actorType: 'SYSTEM',
    });
    expect(id).toBe('auto-1:deal-1');
  });

  it('usa automationId + customerId quando dealId está ausente (ex.: CUSTOMER_INACTIVE)', () => {
    const id = automationJobId({
      organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', actorType: 'SYSTEM',
    });
    expect(id).toBe('auto-1:cust-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter shared-types test -- automation.types`
Expected: FAIL — `automationJobId is not exported`.

- [ ] **Step 3: Implementar em `automation.types.ts`**

```ts
export function automationJobId(data: AutomationExecutionJobData): string {
  return `${data.automationId}:${data.dealId ?? data.customerId}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter shared-types test -- automation.types`
Expected: PASS 2/2.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/automation.types.ts packages/shared-types/src/automation.types.spec.ts
git commit -m "feat(shared-types): automationJobId — dedup de job por par (automação, alvo)"
```

---

### Task 5: Aplicar `jobId` + `defaultJobOptions` nos dois produtores

**Files:**
- Modify: `apps/api/src/infrastructure/queue/automation-queue.service.ts`
- Modify: `apps/api/src/infrastructure/queue/automation-queue.service.spec.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: `automationJobId` (Task 4).
- Produces: nada consumido por task posterior.

Sem teste automatizado pra `apps/worker/src/main.ts` (sem suíte própria, mesma convenção já usada nesse
arquivo) — verificado por build.

- [ ] **Step 1: Write the failing test (api)**

Em `automation-queue.service.spec.ts`, atualizar a asserção existente:

```ts
it('enfileira o job na fila automation-execution com o payload recebido e jobId de dedup', async () => {
  // ...setup igual...
  await service.enqueue(data);

  expect(Queue).toHaveBeenCalledWith(
    'automation-execution',
    expect.objectContaining({ defaultJobOptions: expect.objectContaining({ removeOnComplete: expect.anything(), removeOnFail: expect.anything() }) }),
  );
  expect(queueInstance.add).toHaveBeenCalledWith('execute', data, { jobId: 'auto-1:cust-1' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- automation-queue.service.spec`
Expected: FAIL — `add` chamado sem o terceiro argumento, `Queue` chamado sem `defaultJobOptions`.

- [ ] **Step 3: Implementar**

`automation-queue.service.ts`: importar `automationJobId` de `@opsmind/shared-types`; no construtor, `new
Queue(..., { connection: this.connection, defaultJobOptions: { removeOnComplete: { count: 500 },
removeOnFail: { count: 500 } } })`; em `enqueue()`, `this.queue.add('execute', data, { jobId:
automationJobId(data) })`.

`apps/worker/src/queue.ts` (`createAutomationQueue`): mesmo `defaultJobOptions` no `new Queue(...)`.

`apps/worker/src/main.ts`: nos 3 call-sites de `queue.add('execute', data)` (dentro de `runScan` e
`runDealAutomationsScan`), trocar para `queue.add('execute', data, { jobId: automationJobId(data) })`;
importar `automationJobId` de `@opsmind/shared-types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- automation-queue.service.spec`
Expected: PASS.

- [ ] **Step 5: Prova real do dedup contra Redis (Review Focus)**

A asserção do Step 1 confirma só que o argumento `jobId` é passado — não prova que o BullMQ de fato dedupa.
Adicionar em `apps/worker/test/automation.e2e-spec.ts` (Postgres+Redis reais já configurados no arquivo):

```ts
it('automationJobId faz o BullMQ deduplicar dois enqueues do mesmo par (automação, alvo) antes do primeiro job terminar', async () => {
  const data = { organizationId: 'org-x', automationId: 'auto-x', customerId: 'cust-x', actorType: 'SYSTEM' as const };
  const jobId = automationJobId(data);

  const job1 = await queue.add('execute', data, { jobId });
  const job2 = await queue.add('execute', data, { jobId });

  // Mesmo jobId, job ainda não processado (waiting/active) => BullMQ devolve
  // o MESMO job em vez de criar um segundo — é a prova real de dedup.
  expect(job2.id).toBe(job1.id);

  await job1.remove(); // limpeza — não deixar pendurado pra não interferir nos outros testes do arquivo
});
```

Import `automationJobId` de `@opsmind/shared-types` no topo do arquivo.

Run: `pnpm --filter worker test:e2e -- automation.e2e-spec` (precisa Postgres+Redis up; parar qualquer
processo `apps/worker` de dev rodando localmente antes, pra não competir pela mesma fila).
Expected: PASS, incluindo os testes pré-existentes de `CUSTOMER_INACTIVE`.

- [ ] **Step 6: Build do worker e suíte completa da API**

Run: `pnpm --filter worker run build && pnpm --filter api test`
Expected: ambos sem erro, nenhuma regressão.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/infrastructure/queue/automation-queue.service.ts apps/api/src/infrastructure/queue/automation-queue.service.spec.ts apps/worker/src/queue.ts apps/worker/src/main.ts apps/worker/test/automation.e2e-spec.ts
git commit -m "feat(automations): jobId de dedup + limpeza de jobs completos/falhos na fila automation-execution"
```

---

### Task 6: Corrigir dedup inconsistente de `DEAL_SILENT_FOR`

**Files:**
- Modify: `apps/worker/src/automation-scan.ts`
- Modify: `apps/worker/src/automation-scan.spec.ts`

**Interfaces:**
- Consumes: nada de outra task desta sprint (independente de Tasks 4/5 — arquivo diferente).
- Produces: nada consumido por task posterior.

- [ ] **Step 1: Write the failing test**

Em `automation-scan.spec.ts`, dentro do describe de `scanDealSilentForAutomations`:

```ts
it('reabre a automação quando o deal mudou de etapa e voltou a ficar quieto, mesmo com uma execução SUCCESS anterior baseada em lastActivityAt antigo', async () => {
  const prisma = buildPrisma();
  prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
  const lastActivityAt = new Date('2020-01-01'); // bem antigo
  const stageEnteredAt = new Date(); // recente — deal mudou de etapa há pouco
  prisma.deal.findMany.mockResolvedValue([
    { id: 'deal-1', customerId: 'cust-1', stage: 'NEGOTIATION', stageEnteredAt, customer: { lastActivityAt } },
  ]);
  // Uma execução SUCCESS antiga, criada DEPOIS de lastActivityAt mas ANTES de stageEnteredAt —
  // o dedup antigo (createdAt > lastActivityAt) bloquearia incorretamente; o novo (createdAt >
  // referenceActivity, que aqui é stageEnteredAt) não bloqueia, porque stageEnteredAt é mais recente
  // que o run antigo.
  prisma.automationRun.findFirst.mockResolvedValue(null); // simula: nenhum run depois do stageEnteredAt novo
  const enqueue = jest.fn();

  const count = await scanDealSilentForAutomations(prisma as never, enqueue);

  expect(prisma.automationRun.findFirst).toHaveBeenCalledWith({
    where: { automationId: 'auto-1', dealId: 'deal-1', status: 'SUCCESS', createdAt: { gt: stageEnteredAt } },
  });
  expect(enqueue).toHaveBeenCalled();
  expect(count).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- automation-scan.spec`
Expected: FAIL — a asserção de `findFirst` espera `createdAt: { gt: stageEnteredAt }`, mas o código hoje
passa `createdAt: { gt: lastActivityAt }`.

- [ ] **Step 3: Implementar**

Em `scanDealSilentForAutomations`, a query de dedup (`prisma.automationRun.findFirst`) já está dentro do
loop que calcula `referenceActivity` (Step de condição, linha imediatamente anterior) — trocar `createdAt: {
gt: deal.customer.lastActivityAt! }` por `createdAt: { gt: referenceActivity }`. Atualizar também o
comentário de topo da função (hoje diz "Dedup por `customer.lastActivityAt` (não por `stageEnteredAt`)" —
isso deixou de ser verdade; o dedup agora usa o mesmo `referenceActivity` da condição de disparo).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- automation-scan.spec`
Expected: PASS, incluindo todos os testes pré-existentes (nenhum deles distinguia `lastActivityAt` de
`referenceActivity` quando os dois coincidem, então não devem quebrar).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/automation-scan.ts apps/worker/src/automation-scan.spec.ts
git commit -m "fix(worker): dedup de DEAL_SILENT_FOR usa o mesmo sinal de atividade da condição de disparo"
```

---

### Task 7: Cobertura de teste dos guards novos do processor

**Files:**
- Modify: `apps/worker/src/automation-processor.spec.ts`

**Interfaces:**
- Consumes: nada (só adiciona testes a comportamento já existente em `automation-processor.ts`).
- Produces: nada.

- [ ] **Step 1: Write the failing tests**

6 casos novos (3 guards × 2 triggers de Deal), seguindo o padrão de `buildTx()`/`jest.requireMock
('./tenant-context')` já usado no arquivo:

```ts
describe.each(['DEAL_STAGE_STALE', 'DEAL_SILENT_FOR'] as const)('processAutomationJob — guards de %s', (trigger) => {
  const jobDataNoDealId = { organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', actorType: 'SYSTEM' as const };
  const automation = { id: 'auto-1', organizationId: 'org-1', trigger, conditions: {}, actions: { createTask: true } };

  it('marca SKIPPED "dealId ausente no job" quando data.dealId está ausente', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(automation);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    mockWithTenantContext(tx);

    await processAutomationJob({} as never, jobDataNoDealId);

    expect(tx.deal.findFirst).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED', result: { reason: 'dealId ausente no job' } }),
    });
  });

  it('marca SKIPPED "Negócio não encontrado ou excluído" quando o deal não existe', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(automation);
    tx.deal.findFirst.mockResolvedValue(null);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    mockWithTenantContext(tx);

    await processAutomationJob({} as never, { ...jobDataNoDealId, dealId: 'deal-x' });

    expect(tx.customer.findFirst).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED', result: { reason: 'Negócio não encontrado ou excluído' } }),
    });
  });

  it('marca SKIPPED "Cliente do negócio não encontrado ou excluído" quando o customer do deal não existe', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(automation);
    tx.deal.findFirst.mockResolvedValue({ id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION', stageEnteredAt: new Date(), ownerUserId: null, title: 'X' });
    tx.customer.findFirst.mockResolvedValue(null);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    mockWithTenantContext(tx);

    await processAutomationJob({} as never, { ...jobDataNoDealId, dealId: 'deal-1' });

    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED', result: { reason: 'Cliente do negócio não encontrado ou excluído' } }),
    });
  });
});
```

(`mockWithTenantContext(tx)` é um pequeno helper local pro `const { withTenantContext } =
jest.requireMock('./tenant-context'); withTenantContext.mockImplementation((_p, _o, fn) => fn(tx));` já
repetido em todo teste existente do arquivo — extrair como função se ainda não existir, pra não repetir nos
6 casos.)

- [ ] **Step 2: Run tests to verify they fail or pass for the right reason**

Run: `pnpm --filter worker test -- automation-processor.spec`
Expected: a lógica já existe em produção (confirmada nas Tasks anteriores desta sessão) — então estes testes
devem passar de primeira SE a implementação já estiver correta. Se algum falhar, é porque a asserção não
bate com o comportamento real (ex.: mensagem de reason diferente) — ajustar a asserção pro texto real, nunca
o inverso.

- [ ] **Step 3: Run tests to confirm green**

Run: `pnpm --filter worker test -- automation-processor.spec`
Expected: PASS, 6 novos + todos os pré-existentes.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/automation-processor.spec.ts
git commit -m "test(worker): cobre os 3 guards dos triggers de Deal no processor (dealId ausente, deal/cliente não encontrado)"
```

---

### Task 8: `dealId` no registro `FAILED`

**Files:**
- Modify: `apps/worker/src/automation-processor.ts`
- Modify: `apps/worker/src/automation-processor.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Write the failing test**

```ts
describe('processAutomationJob — FAILED preserva dealId', () => {
  it('grava dealId no AutomationRun FAILED quando o job é de um trigger de Deal e algo lança', async () => {
    const prisma = { automationRun: { create: jest.fn().mockResolvedValue({ id: 'run-1', status: 'FAILED' }) } };
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation(() => { throw new Error('falha simulada'); });

    const jobData = { organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM' as const };
    await processAutomationJob(prisma as never, jobData);

    expect(prisma.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FAILED', dealId: 'deal-1' }),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- automation-processor.spec`
Expected: FAIL — `dealId` ausente no objeto passado a `automationRun.create` no bloco `catch`.

- [ ] **Step 3: Implementar**

No bloco `catch` de `processAutomationJob` (fora da transação), adicionar `dealId: data.dealId` ao `data` do
`prisma.automationRun.create` — `AutomationRun.dealId` já é nullable/opcional no schema, `undefined` quando
o trigger é `CUSTOMER_INACTIVE` é um valor válido (Prisma trata `undefined` como "não definir o campo").

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- automation-processor.spec`
Expected: PASS.

- [ ] **Step 5: Run full worker suite and commit**

Run: `pnpm --filter worker test`
Expected: PASS, nenhuma regressão.

```bash
git add apps/worker/src/automation-processor.ts apps/worker/src/automation-processor.spec.ts
git commit -m "fix(worker): registro FAILED de automação preserva dealId pros triggers de Deal"
```

---

### Task 9: Descrição amigável da task de `DEAL_STAGE_STALE`

**Files:**
- Modify: `apps/worker/src/automation-processor.ts`
- Modify: `apps/worker/src/automation-processor.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Write the failing test**

```ts
it('descrição da task cita o rótulo em português da etapa, não o enum cru', async () => {
  const tx = buildTx();
  tx.automation.findFirst.mockResolvedValue({ id: 'auto-1', organizationId: 'org-1', trigger: 'DEAL_STAGE_STALE', conditions: {}, actions: { createTask: true } });
  tx.deal.findFirst.mockResolvedValue({ id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION', stageEnteredAt: new Date('2000-01-01'), ownerUserId: null, title: 'Contrato X' });
  tx.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Acme' });
  tx.task.create.mockResolvedValue({ id: 'task-1' });
  tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SUCCESS' });
  mockWithTenantContext(tx);

  await processAutomationJob({} as never, { organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM' });

  expect(tx.task.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ description: 'Negócio parado na etapa Qualificação além do tempo esperado.' }),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- automation-processor.spec`
Expected: FAIL — descrição atual usa `QUALIFICATION` cru, não "Qualificação".

- [ ] **Step 3: Implementar**

Mapa local de módulo em `automation-processor.ts` (mesma convenção de duplicação já usada no arquivo pras
interfaces de conditions/actions — não mover de `apps/web`, que o worker não pode importar):

```ts
const DEAL_STAGE_LABELS_PT: Record<string, string> = {
  QUALIFICATION: 'Qualificação', PROPOSAL: 'Proposta', NEGOTIATION: 'Negociação',
  CONTRACT_SENT: 'Contrato enviado', WON: 'Ganho', LOST: 'Perdido',
};
```

No case `DEAL_STAGE_STALE`, trocar `` `Negócio parado na etapa ${deal.stage} além do tempo esperado.` ``
por `` `Negócio parado na etapa ${DEAL_STAGE_LABELS_PT[deal.stage] ?? deal.stage} além do tempo esperado.` ``
(fallback pro enum cru se um valor não mapeado aparecer — nunca lança, só degrada o texto).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- automation-processor.spec`
Expected: PASS.

- [ ] **Step 5: Run full worker suite and commit**

Run: `pnpm --filter worker test`
Expected: PASS, nenhuma regressão.

```bash
git add apps/worker/src/automation-processor.ts apps/worker/src/automation-processor.spec.ts
git commit -m "fix(worker): descrição da task de reativação usa rótulo em português da etapa"
```
