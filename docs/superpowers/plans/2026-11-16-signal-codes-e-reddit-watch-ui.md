# Governança de SignalCode + UI de RedditWatchTopic (Harvey Fases 5/6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar as Fases 5 e 6 do roadmap Harvey — expor o ciclo de vida PROPOSED→CONFIRMED de `SignalCode`
(controller + AI tool + tela de revisão) e dar a `RedditWatchTopic` a UI que falta (todo o backend já
existe).

**Architecture:** Fase 5 adiciona uma camada HTTP+AI-tool fina sobre `SignalCodesService`, que já existe e
já tem `list`/`propose`/`confirm` testados — nenhuma lógica de negócio nova. Fase 6 é só frontend: controller,
service, DTOs e hooks de `RedditWatchTopic` já existem por completo; falta a página, seguindo ponto a ponto
o padrão de `prospecting-targets/page.tsx`.

**Tech Stack:** NestJS (`apps/api`), Next.js 14 App Router + react-hook-form + zod + TanStack Query
(`apps/web`).

**Spec:** `docs/planning/2026-11-06-harvey-inteligencia-comercial.md` (seções 4, 5, 6, 8 — Fases 5 e 6).

## Global Constraints

- `SignalCodesService.propose()` SEMPRE cria com `status: 'PROPOSED'` e escopado à organização que chama —
  nunca global (`organizationId: null`), nunca já `CONFIRMED`. Nenhuma tool de IA pode confirmar um código
  — só um humano, via rota REST (regra já implementada no service, esta plano só expõe o caminho de
  escrita, nunca a contorna).
- Confirmar um `SignalCode` é uma ação de governança de vocabulário com efeito duradouro no scoring de
  toda a organização — mais restrita que `WRITE_ROLES` comum: exige papel `MANAGER` ou acima (mesmo
  mecanismo de hierarquia de `apps/api/src/shared/guards/roles.guard.ts`, que já trata `@Roles('MANAGER')`
  como "MANAGER e acima", não "exatamente MANAGER").
- Tools de IA nunca aceitam `organizationId`/`userId`/`role` como propriedade do `inputSchema` — vêm sempre
  de `AiToolContext`, injetado pelo `AiService` a partir da sessão autenticada.
- `RedditWatchTopic` não ganha nenhum endpoint novo nesta sprint — a página nova consome exatamente os 5
  hooks já existentes em `apps/web/lib/market-opportunities/use-reddit-watch-topics.ts`.

## Review Focus

- `VIEWER` tentando propor um `SignalCode` (via tool de IA OU via `POST` direto) precisa ser rejeitado com
  403/`ForbiddenException` nos dois caminhos, não só um (Tasks 1, 2).
- Um papel abaixo de `MANAGER` (ex.: `MEMBER`) tentando confirmar um código precisa ser rejeitado — a
  governança é mais restrita que escrita comum, e é fácil esquecer e usar `WRITE_ROLES` por hábito (Task 1).
- Propor um `code` que já existe (em qualquer status) precisa devolver um erro claro ao chamador (já existe
  no service — `BadRequestException`), não um 500 genérico escondido atrás da tool/controller (Tasks 1, 2).
- Confirmar um código que já não está em `PROPOSED` (já `CONFIRMED` ou `DEPRECATED`) precisa ser rejeitado
  com o mesmo tipo de erro claro (já existe no service) — a tela nova precisa mostrar esse erro ao usuário,
  não engolir (Task 4).
- A tela de `RedditWatchTopic` não pode introduzir uma segunda forma de mudar `isActive`/remover um tópico
  — tudo passa pelos hooks já existentes, nenhum endpoint novo (Task 5).

---

### Task 1: Backend — `SignalCodesController`

**Files:**
- Create: `apps/api/src/modules/leads/signal-codes.controller.ts`
- Create: `apps/api/src/modules/leads/signal-codes.controller.spec.ts`
- Create: `apps/api/src/modules/leads/dto/create-signal-code.dto.ts`
- Modify: `apps/api/src/modules/leads/leads.module.ts` (adicionar `SignalCodesController` ao array
  `controllers`)
- Modify: `apps/api/test/leads.e2e-spec.ts` (2 casos novos de RBAC — ver Step 6; Postgres+Redis reais já
  rodando localmente, mesmo padrão já usado neste arquivo)

**Interfaces:**
- Consumes: `SignalCodesService.list(organizationId)`, `.propose(organizationId, dto, actorUserId)`,
  `.confirm(organizationId, code, actorUserId)` — já existem, assinaturas confirmadas em
  `apps/api/src/modules/leads/signal-codes.service.ts`.
- Produces: `GET organizations/:organizationId/signal-codes`, `POST organizations/:organizationId/
  signal-codes`, `POST organizations/:organizationId/signal-codes/:code/confirm`. Task 3 (frontend)
  consome esses 3 endpoints exatamente.

- [ ] **Step 1: Write the failing tests**

```ts
// signal-codes.controller.spec.ts
import { SignalCodesController } from './signal-codes.controller';

describe('SignalCodesController', () => {
  function buildService() {
    return { list: jest.fn(), propose: jest.fn(), confirm: jest.fn() };
  }

  it('list: repassa organizationId pro service', async () => {
    const service = buildService();
    service.list.mockResolvedValue([{ code: 'NO_WEBSITE' }]);
    const controller = new SignalCodesController(service as never);

    const result = await controller.list('org-1');

    expect(result).toEqual([{ code: 'NO_WEBSITE' }]);
    expect(service.list).toHaveBeenCalledWith('org-1');
  });

  it('propose: repassa organizationId, dto e userId pro service', async () => {
    const service = buildService();
    service.propose.mockResolvedValue({ code: 'NEW_CODE', status: 'PROPOSED' });
    const controller = new SignalCodesController(service as never);
    const dto = { code: 'NEW_CODE', label: 'Novo código', category: 'tecnologia' };

    const result = await controller.propose('org-1', { id: 'user-1' } as never, dto as never);

    expect(result).toEqual({ code: 'NEW_CODE', status: 'PROPOSED' });
    expect(service.propose).toHaveBeenCalledWith('org-1', dto, 'user-1');
  });

  it('confirm: repassa organizationId, code e userId pro service', async () => {
    const service = buildService();
    service.confirm.mockResolvedValue({ code: 'NEW_CODE', status: 'CONFIRMED' });
    const controller = new SignalCodesController(service as never);

    const result = await controller.confirm('org-1', 'NEW_CODE', { id: 'user-1' } as never);

    expect(result).toEqual({ code: 'NEW_CODE', status: 'CONFIRMED' });
    expect(service.confirm).toHaveBeenCalledWith('org-1', 'NEW_CODE', 'user-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- signal-codes.controller.spec`
Expected: FAIL — `Cannot find module './signal-codes.controller'`.

- [ ] **Step 3: Implementar `CreateSignalCodeDto`**

```ts
// dto/create-signal-code.dto.ts
import { IsNotEmpty, MaxLength } from 'class-validator';

export class CreateSignalCodeDto {
  @IsNotEmpty() @MaxLength(60) code!: string;
  @IsNotEmpty() @MaxLength(120) label!: string;
  @IsNotEmpty() @MaxLength(60) category!: string;
}
```

- [ ] **Step 4: Implementar `SignalCodesController`**

Mesmo padrão de `ProspectingTargetsController` (guards, decorators). `SIGNAL_CODE_GOVERNANCE_ROLE =
'MANAGER' as const` declarada no topo do arquivo (comentário de uma linha: "governança de vocabulário —
mais restrita que WRITE_ROLES comum, efeito dura em todo o scoring da organização"). `list` sem guard de
role (leitura aberta, mesmo padrão de `AutomationsController.list`). `propose` com `@Roles(...WRITE_ROLES)`.
`confirm` com `@Roles(SIGNAL_CODE_GOVERNANCE_ROLE)`. Todos sob `@UseGuards(TenantGuard)` a nível de classe,
`@Controller('organizations/:organizationId/signal-codes')`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api test -- signal-codes.controller.spec`
Expected: PASS 3/3.

- [ ] **Step 6: Registrar no módulo e adicionar os 2 casos de RBAC no e2e (Review Focus)**

Adicionar `SignalCodesController` ao array `controllers` de `leads.module.ts` (ao lado dos outros 5
controllers já registrados).

Em `apps/api/test/leads.e2e-spec.ts`, no mesmo estilo dos casos de RBAC já existentes nesse arquivo
(organização/membership/token já montados num helper/`beforeEach` existente — reusar, não duplicar
setup):

```ts
it('POST /signal-codes — MEMBER consegue propor, VIEWER recebe 403', async () => {
  const memberResponse = await request(app.getHttpServer())
    .post(`/organizations/${organization.id}/signal-codes`)
    .set('Authorization', `Bearer ${memberToken}`)
    .send({ code: 'TESTE_RBAC', label: 'Teste RBAC', category: 'teste' });
  expect(memberResponse.status).toBe(201);

  const viewerResponse = await request(app.getHttpServer())
    .post(`/organizations/${organization.id}/signal-codes`)
    .set('Authorization', `Bearer ${viewerToken}`)
    .send({ code: 'TESTE_RBAC_2', label: 'Teste', category: 'teste' });
  expect(viewerResponse.status).toBe(403);
});

it('POST /signal-codes/:code/confirm — exige MANAGER ou acima, MEMBER recebe 403', async () => {
  await request(app.getHttpServer())
    .post(`/organizations/${organization.id}/signal-codes`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ code: 'TESTE_CONFIRM', label: 'Teste', category: 'teste' });

  const memberResponse = await request(app.getHttpServer())
    .post(`/organizations/${organization.id}/signal-codes/TESTE_CONFIRM/confirm`)
    .set('Authorization', `Bearer ${memberToken}`);
  expect(memberResponse.status).toBe(403);

  const managerResponse = await request(app.getHttpServer())
    .post(`/organizations/${organization.id}/signal-codes/TESTE_CONFIRM/confirm`)
    .set('Authorization', `Bearer ${managerToken}`);
  expect(managerResponse.status).toBe(200);
  expect(managerResponse.body.status).toBe('CONFIRMED');
});
```

(Nomes exatos de `memberToken`/`viewerToken`/`ownerToken`/`managerToken` dependem do helper de setup já
existente no arquivo — usar os equivalentes já lá, mesmo se os nomes de variável forem outros.)

Run: `pnpm --filter api test` e `pnpm --filter api test:e2e -- leads.e2e-spec` (precisa Postgres+Redis up).
Expected: ambos PASS, nenhuma regressão.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/leads/signal-codes.controller.ts apps/api/src/modules/leads/signal-codes.controller.spec.ts apps/api/src/modules/leads/dto/create-signal-code.dto.ts apps/api/src/modules/leads/leads.module.ts apps/api/test/leads.e2e-spec.ts
git commit -m "feat(api): SignalCodesController — governança de vocabulário via HTTP"
```

---

### Task 2: Backend — AI tool `propose_signal_code`

**Files:**
- Create: `apps/api/src/modules/ai/tools/propose-signal-code.tool.ts`
- Create: `apps/api/src/modules/ai/tools/propose-signal-code.tool.spec.ts`
- Modify: `apps/api/src/modules/ai/ai.module.ts`

**Interfaces:**
- Consumes: `SignalCodesService.propose(organizationId, dto, actorUserId)` (já existe); `WRITE_ROLES`
  (`apps/api/src/shared/constants/roles.constant.ts`); padrão de gate manual de `ScoreLeadTool`
  (`score-lead.tool.ts`).
- Produces: `propose_signal_code` tool registrada em `AI_TOOLS`. Nenhuma task posterior consome.

- [ ] **Step 1: Write the failing tests**

```ts
// propose-signal-code.tool.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { ProposeSignalCodeTool } from './propose-signal-code.tool';

describe('ProposeSignalCodeTool', () => {
  it('propõe o código e retorna o SignalCode criado', async () => {
    const signalCodesService = {
      propose: jest.fn().mockResolvedValue({ code: 'HIRING_SURGE', status: 'PROPOSED' }),
    };
    const tool = new ProposeSignalCodeTool(signalCodesService as never);

    const result = await tool.execute(
      { code: 'HIRING_SURGE', label: 'Contratando em massa', category: 'crescimento' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toEqual({ code: 'HIRING_SURGE', status: 'PROPOSED' });
    expect(signalCodesService.propose).toHaveBeenCalledWith(
      'org-1',
      { code: 'HIRING_SURGE', label: 'Contratando em massa', category: 'crescimento' },
      'user-1',
    );
  });

  it('recusa propor quando o papel do usuário que invocou é VIEWER', async () => {
    const signalCodesService = { propose: jest.fn() };
    const tool = new ProposeSignalCodeTool(signalCodesService as never);

    await expect(
      tool.execute(
        { code: 'X', label: 'Y', category: 'Z' },
        { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(signalCodesService.propose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- propose-signal-code.tool.spec`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `ProposeSignalCodeTool`**

Mesmo esqueleto de `ScoreLeadTool`: `name = 'propose_signal_code'`, `inputSchema` com `code`/`label`/
`category` (todos `string`, todos `required`, `additionalProperties: false`), gate manual (`if
(!(WRITE_ROLES as readonly string[]).includes(context.role)) throw new ForbiddenException(...)`), depois
`this.signalCodesService.propose(context.organizationId, input, context.userId)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- propose-signal-code.tool.spec`
Expected: PASS 2/2.

- [ ] **Step 5: Registrar em `ai.module.ts`**

4 pontos (mesmo padrão de todas as outras ~20 tools já registradas): import; `providers` array; parâmetro
da factory de `AI_TOOLS` + item no array de retorno; item no array `inject`.

- [ ] **Step 6: Run full API suite and commit**

Run: `pnpm --filter api test`
Expected: PASS, nenhuma regressão.

```bash
git add apps/api/src/modules/ai/tools/propose-signal-code.tool.ts apps/api/src/modules/ai/tools/propose-signal-code.tool.spec.ts apps/api/src/modules/ai/ai.module.ts
git commit -m "feat(api): tool de IA propose_signal_code"
```

Verificação manual opcional (precisa de `ANTHROPIC_API_KEY` real, já configurada no `.env` local): perguntar
ao Assistente IA (`/organizations/:id/ai`) algo como "proponha um novo código de sinal chamado TESTE_X pra
categoria teste" e confirmar que a tool é chamada e o `SignalCode` aparece em `GET .../signal-codes` com
`status: PROPOSED`.

---

### Task 3: Frontend — tipos e hooks de `SignalCode`

**Files:**
- Modify: `apps/web/lib/leads/types.ts`
- Create: `apps/web/lib/leads/use-signal-codes.ts`

**Interfaces:**
- Consumes: os 3 endpoints da Task 1 (`GET/POST .../signal-codes`, `POST .../signal-codes/:code/confirm`).
- Produces: `SignalCodeStatus`, `SignalCode`, `CreateSignalCodeInput`, `SIGNAL_CODE_CONFIRM_ROLES`.
  `useSignalCodes`, `useProposeSignalCode`, `useConfirmSignalCode`. Task 4 consome esses nomes exatamente.

Sem suíte de teste automatizada em `apps/web` — verificação por typecheck.

- [ ] **Step 1: Tipos em `types.ts`**

Adicionar ao final do arquivo:

```ts
export type SignalCodeStatus = 'PROPOSED' | 'CONFIRMED' | 'DEPRECATED';

export interface SignalCode {
  code: string;
  organizationId: string | null;
  label: string;
  category: string;
  defaultServiceOfferingId: string | null;
  status: SignalCodeStatus;
  createdAt: string;
}

export interface CreateSignalCodeInput {
  code: string;
  label: string;
  category: string;
}

// Confirmar um SignalCode é governança de vocabulário com efeito duradouro
// no scoring da organização — mais restrito que WRITE_ROLES comum, espelha
// apps/api/src/modules/leads/signal-codes.controller.ts (SIGNAL_CODE_GOVERNANCE_ROLE).
export const SIGNAL_CODE_CONFIRM_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER'];
```

- [ ] **Step 2: `use-signal-codes.ts`**

Mesmo padrão de `use-prospecting-targets.ts` (`apiFetch`, `useQueryClient`/`invalidateQueries` na query key
`['organizations', organizationId, 'signal-codes']`):

```ts
export function useSignalCodes(organizationId: string) { /* useQuery, GET .../signal-codes */ }
export function useProposeSignalCode(organizationId: string) { /* useMutation POST, invalida a lista */ }
export function useConfirmSignalCode(organizationId: string) {
  /* useMutation; mutationFn: (code: string) => POST .../signal-codes/${code}/confirm; invalida a lista */
}
```

- [ ] **Step 3: Typecheck e commit**

Run: `pnpm --filter web run typecheck`
Expected: sem erro.

```bash
git add apps/web/lib/leads/types.ts apps/web/lib/leads/use-signal-codes.ts
git commit -m "feat(web): tipos e hooks de SignalCode"
```

---

### Task 4: Frontend — tela de revisão de `SignalCode`

**Files:**
- Create: `apps/web/app/organizations/[organizationId]/signal-codes/page.tsx`
- Modify: `apps/web/lib/nav-items.ts`

**Interfaces:**
- Consumes: `useSignalCodes`, `useConfirmSignalCode` (Task 3).

Sem suíte de teste automatizada — verificação manual + typecheck. Tela de REVISÃO apenas (listar +
confirmar) — sem criar código manualmente pela UI nesta sprint (criação é só via tool de IA, Task 2; YAGNI
até aparecer necessidade real de um formulário manual).

- [ ] **Step 1: `page.tsx`**

- `useCurrentMembership` + `canConfirm = membership ? SIGNAL_CODE_CONFIRM_ROLES.includes(membership.role)
  : false` (NÃO `WRITE_ROLES` — é o papel mais restrito da Task 3).
- Tabela (`@/components/ui/table`): colunas Código, Rótulo, Categoria, Status (`<Badge value={code.status}
  />` — adicionar `PROPOSED`/`CONFIRMED`/`DEPRECATED` ao `COLORS` de `badge.tsx` se ainda não existirem;
  reusar cor de `PROPOSED`/outro status já mapeado por analogia, ex. `DISCOVERED`/`QUALIFIED`/
  `DISQUALIFIED`), Criado em, Ações.
- Coluna Ações: botão "Confirmar" (só quando `canConfirm && code.status === 'PROPOSED'`,
  `confirmCode.mutate(code.code)`, `isLoading={confirmCode.isPending && confirmCode.variables ===
  code.code}`). Sem dropdown — uma ação só, botão direto.
- Exibir o erro da mutation (`confirmCode.isError ? (confirmCode.error as ApiError).message : null`) via
  `FormError`, para o caso de alguém confirmar um código que mudou de status entre a listagem e o clique
  (Review Focus).

- [ ] **Step 2: Nav item**

Em `nav-items.ts`, adicionar ao array `NAV_ITEMS` (grupo `workspace`, ícone `Tag` de `lucide-react`):
`{ label: 'Códigos de sinal', segment: 'signal-codes', icon: Tag, group: 'workspace' }` — sem `roles`
(leitura aberta a todo membro; só o botão "Confirmar" é restrito dentro da página).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web run typecheck`
Expected: sem erro.

- [ ] **Step 4: Verificação manual**

Run: `pnpm --filter web dev` (+ api up).
Expected: listar códigos globais semeados (status `CONFIRMED`, sem botão de ação); propor um código novo
via chat de IA (Task 2) ou diretamente via `curl`/Postman contra o endpoint da Task 1; confirmar que ele
aparece com status `PROPOSED` e botão "Confirmar" visível só para papel `MANAGER`+; clicar e confirmar que
o status muda para `CONFIRMED` e o botão desaparece.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/organizations/[organizationId]/signal-codes" apps/web/lib/nav-items.ts apps/web/components/ui/badge.tsx
git commit -m "feat(web): tela de revisão de SignalCode (PROPOSED→CONFIRMED)"
```

---

### Task 5: Frontend — tela de `RedditWatchTopic`

**Files:**
- Create: `apps/web/app/organizations/[organizationId]/reddit-watch-topics/page.tsx`
- Modify: `apps/web/lib/nav-items.ts`

**Interfaces:**
- Consumes: `useRedditWatchTopics`, `useCreateRedditWatchTopic`, `useUpdateRedditWatchTopic`,
  `useRunRedditWatchTopicNow`, `useRemoveRedditWatchTopic` (já existem em
  `apps/web/lib/market-opportunities/use-reddit-watch-topics.ts`); `RedditWatchTopic`,
  `CreateRedditWatchTopicInput`, `UpdateRedditWatchTopicInput` (já existem em
  `apps/web/lib/market-opportunities/types.ts`).

Sem suíte de teste automatizada — verificação manual + typecheck. Depende da Task 4 só porque as duas
tocam `nav-items.ts` — executar depois para evitar conflito de edição no mesmo arquivo.

- [ ] **Step 1: `page.tsx`**

Copiar a estrutura de `prospecting-targets/page.tsx` ponto a ponto (Dialog único reaproveitado pra criar/
editar, tabela com dropdown de ações, diálogo de confirmação de remoção):
- Formulário (zod): `query: z.string().min(1).max(200)`, `subreddit: z.string().max(100).optional()`,
  `isActive: z.boolean().optional()`. `DEFAULT_VALUES: { query: '', subreddit: '', isActive: true }`.
- Tabela: colunas Query, Subreddit, Status (`Badge` ACTIVE/INACTIVE), Último scan (`lastScanStatus` em
  `Badge` — `OK`/`ERROR`/`SKIPPED_BUDGET`, adicionar ao `COLORS` de `badge.tsx` se ainda não existirem,
  reusando cor por analogia: `OK`→`ACTIVE`, `ERROR`→`DISQUALIFIED`, `SKIPPED_BUDGET`→`INACTIVE`), Criado em,
  Ações.
- Dropdown de ações (só quando `canWrite`, mesmo padrão `WRITE_ROLES` de `prospecting-targets`):
  "Executar agora" (`runNow.mutate(topic.id)`, `disabled={runNow.isPending && runNow.variables ===
  topic.id}`), "Editar" (abre o Dialog em modo edição), separador, "Remover" (abre o diálogo de
  confirmação, mesmo padrão exato de remoção de `prospecting-targets/page.tsx`).

- [ ] **Step 2: Nav item**

Em `nav-items.ts`, adicionar (grupo `workspace`, ícone `MessageCircle` de `lucide-react`, depois do item da
Task 4): `{ label: 'Monitoramento de tópicos', segment: 'reddit-watch-topics', icon: MessageCircle, group:
'workspace' }`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web run typecheck`
Expected: sem erro.

- [ ] **Step 4: Verificação manual**

Run: `pnpm --filter web dev` (+ api/worker up).
Expected: criar um tópico (`query` + `subreddit` opcional); editar; alternar ativo/inativo; disparar
"Executar agora" e confirmar que `lastScanStatus`/`lastScanError` atualizam depois do worker processar;
remover com confirmação. Confirmar que nenhuma chamada de rede nova além dos 5 endpoints já existentes
acontece (aba de rede do browser).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/organizations/[organizationId]/reddit-watch-topics" apps/web/lib/nav-items.ts apps/web/components/ui/badge.tsx
git commit -m "feat(web): tela de monitoramento de RedditWatchTopic"
```
