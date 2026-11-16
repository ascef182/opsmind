# Harvey Fase 7 — Gatilho automático de investigação de site / autodraft ao lead virar QUALIFIED

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Fechar a lacuna onde um lead que vira `QUALIFIED` via `LeadsService.score()` (endpoint manual
`POST .../leads/:id/score` ou AI tool `score_lead`) nunca dispara investigação de site nem rascunho
automático de outreach — ao contrário de um lead qualificado pelo pipeline de scraping em lote, que já
dispara os dois.

**Architecture:** Mover a função pura de prioridade de canal (`resolveAutodraftChannel`) do worker pra
`packages/shared-types` (apps/api precisa da mesma lógica e não pode importar do worker); criar um producer
novo (`OutreachAutodraftQueueService`) em apps/api pra fila `outreach-autodraft` (hoje só o worker produz
nela); replicar a bifurcação já existente em `lead-scrape-processor.ts` dentro de `LeadsService.score()`.

**Tech Stack:** NestJS (apps/api), BullMQ (filas `website-profile`/`outreach-autodraft`), Prisma, Jest.

**Spec:** Não há spec formal separada — a "spec" é o comportamento já implementado e em produção em
`apps/worker/src/lead-scrape-processor.ts:1636-1689` (a bifurcação a replicar) e
`docs/planning/2026-11-06-harvey-inteligencia-comercial.md` §8 item 7 (a intenção original da Fase 7).

## Global Constraints

- `apps/api` e `apps/worker` nunca importam um do outro (CLAUDE.md) — qualquer lógica que os dois precisem
  compartilhar vai para `packages/shared-types`.
- `packages/shared-types` não depende de `@opsmind/database`/Prisma hoje (confirmado via grep) — não
  introduzir essa dependência nesta sprint; tipar como `unknown` onde o código atual usa `Prisma.JsonValue`.
- Todo enfileiramento disparado de dentro de `LeadsService.score()` é best-effort: uma falha ao enfileirar
  (Redis indisponível, etc.) nunca pode fazer `score()` lançar/retornar erro — o score já foi calculado e
  persistido com sucesso antes desse ponto.
- RLS/multi-tenant: todo enqueue leva `organizationId` explícito (nunca inferido) — mesmo padrão de
  `AutomationExecutionJobData`/`WebsiteProfileJobData` já existentes.
- Sem tool de IA nova e sem endpoint novo nesta sprint — a mudança inteira vive dentro de `score()`, que já
  é chamado tanto pelo endpoint REST quanto pela tool `score_lead` (`score-lead.tool.ts:46`, delega 100% pra
  `score()`, sem lógica própria).

## Review Focus

- **Race entre duas chamadas quase simultâneas de `score()` no mesmo lead** (ex.: duplo clique, ou a IA
  chamando `score_lead` duas vezes): sem `jobId` de dedup nas filas, ambas podem passar pela checagem
  "ainda não investigado"/"sem outreach ainda" e enfileirar job duplicado. Documentado como risco residual
  aceito (fora desta sprint) — mas o teste da Task 3 deve cobrir o caminho normal (uma chamada só) com
  precisão, não esse caso de corrida.
- **Lead que regride ou já passou da qualificação** (`CONVERTED`/`LOST`, fora de `PRE_QUALIFICATION_STATUSES`):
  `canUpdateStatus` já impede a troca de status nesses casos — o teste da Task 3 confirma que, nesse caso,
  nada é enfileirado (não só que o status não muda).
- **Lead sem `suggestedOfferingId`**: `OutreachService.generateDraft` falharia com `BadRequestException` sem
  oferta sugerida (mesma razão documentada em `lead-scrape-processor.ts`) — o gatilho nunca pode tentar
  autodraft nesse caso. Testado explicitamente na Task 3.
- **Falha no enfileiramento não pode corromper a resposta do endpoint**: um mock de fila rejeitando precisa
  ainda resultar em `score()` retornando o lead atualizado normalmente — testado explicitamente na Task 3,
  não assumido.
- **`socialLinks` com shape inesperado** (não-array, `null`, objeto solto) na função movida
  `resolveAutodraftChannel`: o comportamento atual já trata isso via `Array.isArray(...)` — a Task 1 precisa
  de um teste que prove que mover a função pra `shared-types` (com `unknown` em vez de `Prisma.JsonValue`)
  não perdeu essa garantia.

---

### Task 1: Mover `resolveAutodraftChannel` para `packages/shared-types`

**Files:**
- Modify: `packages/shared-types/src/outreach-autodraft.types.ts`
- Modify: `apps/worker/src/lead-scrape-processor.ts` (remove a definição local, 1206-1229; importa de
  `@opsmind/shared-types`)
- Modify: `apps/worker/src/website-profiler-processor.ts` (linha 29: troca `import { resolveAutodraftChannel }
  from './lead-scrape-processor'` por `from '@opsmind/shared-types'`)
- Test: `packages/shared-types/src/outreach-autodraft.types.spec.ts` (novo)

**Interfaces:**
- Produces: `export function resolveAutodraftChannel(lead: { whatsapp: string | null; email: string | null;
  phone: string | null; socialLinks: unknown }): OutreachChannel | null` — mesmo corpo de hoje (prioridade
  `WHATSAPP > INSTAGRAM_DM > LINKEDIN_DM > EMAIL > PHONE > null`, parseando `socialLinks` via
  `Array.isArray` antes de qualquer uso), só o tipo do parâmetro `socialLinks` muda de `Prisma.JsonValue`
  para `unknown`. Importa `SocialLink` de `./social-link.types` (já existe no mesmo pacote).
- Consumes (Task 3): `LeadsService.score()` vai chamar esta função já importada de `@opsmind/shared-types`.

- [ ] **Step 1: Escrever o teste em `packages/shared-types/src/outreach-autodraft.types.spec.ts`**

```ts
import { resolveAutodraftChannel } from './outreach-autodraft.types';

describe('resolveAutodraftChannel', () => {
  it('prioriza WHATSAPP quando presente, mesmo com outros campos preenchidos', () => {
    expect(resolveAutodraftChannel({
      whatsapp: '+5511999999999', email: 'a@b.com', phone: '1133334444', socialLinks: [],
    })).toBe('WHATSAPP');
  });

  it('prioriza INSTAGRAM_DM sobre LINKEDIN_DM/EMAIL/PHONE quando não há whatsapp', () => {
    expect(resolveAutodraftChannel({
      whatsapp: null, email: 'a@b.com', phone: '1133334444',
      socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/x' }, { platform: 'LINKEDIN', url: 'https://linkedin.com/x' }],
    })).toBe('INSTAGRAM_DM');
  });

  it('prioriza LINKEDIN_DM sobre EMAIL/PHONE quando não há whatsapp nem instagram', () => {
    expect(resolveAutodraftChannel({
      whatsapp: null, email: 'a@b.com', phone: '1133334444',
      socialLinks: [{ platform: 'LINKEDIN', url: 'https://linkedin.com/x' }],
    })).toBe('LINKEDIN_DM');
  });

  it('cai para EMAIL quando só sobra email e phone', () => {
    expect(resolveAutodraftChannel({ whatsapp: null, email: 'a@b.com', phone: '1133334444', socialLinks: [] })).toBe('EMAIL');
  });

  it('cai para PHONE quando só sobra phone', () => {
    expect(resolveAutodraftChannel({ whatsapp: null, email: null, phone: '1133334444', socialLinks: [] })).toBe('PHONE');
  });

  it('retorna null quando nenhum dos cinco campos está preenchido', () => {
    expect(resolveAutodraftChannel({ whatsapp: null, email: null, phone: null, socialLinks: [] })).toBeNull();
  });

  it('nunca lança e trata socialLinks com shape inesperado (não-array/null) como ausência de redes', () => {
    expect(resolveAutodraftChannel({ whatsapp: null, email: null, phone: null, socialLinks: null })).toBeNull();
    expect(resolveAutodraftChannel({ whatsapp: null, email: null, phone: null, socialLinks: { foo: 'bar' } })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha** (a função ainda não existe em `outreach-autodraft.types.ts`)

Run: `pnpm --filter shared-types test -- outreach-autodraft.types`
Expected: FAIL com "resolveAutodraftChannel is not a function" (ou erro de import)

- [ ] **Step 3: Implementar `resolveAutodraftChannel` em `packages/shared-types/src/outreach-autodraft.types.ts`**

Copiar o corpo exato de `apps/worker/src/lead-scrape-processor.ts:1206-1229`, só trocando a assinatura do
parâmetro `socialLinks` de `Prisma.JsonValue` para `unknown` e importando `SocialLink` de
`./social-link.types`. Adicionar `export`.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter shared-types test -- outreach-autodraft.types`
Expected: PASS 7/7

- [ ] **Step 5: Remover a definição local do worker e trocar os dois imports**

Em `apps/worker/src/lead-scrape-processor.ts`: deletar a função (linhas 1206-1229) e seu `export`, trocar
qualquer uso dentro do arquivo (linha ~1678) por import de `@opsmind/shared-types`. Em
`apps/worker/src/website-profiler-processor.ts:29`: trocar a origem do import.

- [ ] **Step 6: Rodar a suíte completa do worker e confirmar que nada quebrou**

Run: `pnpm --filter worker test`
Expected: PASS (mesmo número de testes de antes — nenhum teste deveria ter testado
`resolveAutodraftChannel` diretamente antes, só indiretamente via `processLeadScrapeJob`)

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/outreach-autodraft.types.ts packages/shared-types/src/outreach-autodraft.types.spec.ts apps/worker/src/lead-scrape-processor.ts apps/worker/src/website-profiler-processor.ts
git commit -m "refactor(shared-types): mover resolveAutodraftChannel pra packages/shared-types"
```

---

### Task 2: `OutreachAutodraftQueueService` em `apps/api`

**Files:**
- Create: `apps/api/src/infrastructure/queue/outreach-autodraft-queue.service.ts`
- Create: `apps/api/src/infrastructure/queue/outreach-autodraft-queue.service.spec.ts`
- Modify: módulo que registra `WebsiteProfileQueueService` como provider (localizar com
  `grep -rn "WebsiteProfileQueueService" apps/api/src/modules/` — adicionar o novo serviço como provider no
  mesmo módulo, com `exports` se `WebsiteProfileQueueService` também for exportado)

**Interfaces:**
- Consumes: `OUTREACH_AUTODRAFT_QUEUE` e `OutreachAutodraftJobData` de `@opsmind/shared-types` (já existem).
- Produces: `class OutreachAutodraftQueueService { enqueue(data: OutreachAutodraftJobData): Promise<unknown> }`
  — Task 3 injeta e chama este método.

- [ ] **Step 1: Escrever o teste em `outreach-autodraft-queue.service.spec.ts`**

Espelhar a estrutura de teste já usada para `website-profile-queue.service.spec.ts` se existir (rodar
`find apps/api/src/infrastructure/queue -name "*.spec.ts"` pra confirmar o padrão exato de mock de
`bullmq`/`ioredis` já usado neste diretório — reaproveitar, não reinventar). Caso não exista nenhum spec de
queue service nesse diretório pra copiar, mockar `bullmq`'s `Queue` (`jest.mock('bullmq')`) e `ioredis`, e
testar:

```ts
it('enqueue() chama queue.add com o nome do job e o payload corretos', async () => {
  // arrange: instanciar o service com ConfigService mockado
  // act: await service.enqueue({ organizationId: 'org1', leadId: 'lead1', channel: 'EMAIL', serviceOfferingId: 'off1' })
  // assert: mockQueueAdd foi chamado com ('draft', { organizationId: 'org1', leadId: 'lead1', channel: 'EMAIL', serviceOfferingId: 'off1' })
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha** (classe ainda não existe)

Run: `pnpm --filter api test -- outreach-autodraft-queue.service`
Expected: FAIL (módulo não encontrado)

- [ ] **Step 3: Implementar `OutreachAutodraftQueueService`**

Copiar `apps/api/src/infrastructure/queue/website-profile-queue.service.ts` inteiro, trocando:
`WEBSITE_PROFILE_QUEUE`/`WebsiteProfileJobData` por `OUTREACH_AUTODRAFT_QUEUE`/`OutreachAutodraftJobData`
(ambos de `@opsmind/shared-types`), e o nome do job em `this.queue.add('investigate', data)` para
`this.queue.add('draft', data)`. Mesmo construtor (conexão Redis própria via `ConfigService`), mesmo
`onModuleDestroy`.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter api test -- outreach-autodraft-queue.service`
Expected: PASS

- [ ] **Step 5: Registrar o novo provider no módulo correto**

Adicionar `OutreachAutodraftQueueService` aos `providers` (e `exports`, se aplicável) do módulo NestJS que já
registra `WebsiteProfileQueueService`.

- [ ] **Step 6: Rodar o build/typecheck da API pra confirmar que o módulo resolve**

Run: `pnpm --filter api run typecheck`
Expected: PASS, sem erro de DI

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/infrastructure/queue/outreach-autodraft-queue.service.ts apps/api/src/infrastructure/queue/outreach-autodraft-queue.service.spec.ts <arquivo do módulo modificado>
git commit -m "feat(api): producer de fila outreach-autodraft (OutreachAutodraftQueueService)"
```

---

### Task 3: Gatilho em `LeadsService.score()`

**Files:**
- Modify: `apps/api/src/modules/leads/leads.service.ts`
- Modify: `apps/api/src/modules/leads/leads.service.spec.ts`

**Interfaces:**
- Consumes: `WebsiteProfileQueueService.enqueue` (Task existente, já usado por `LeadSignalsService`),
  `OutreachAutodraftQueueService.enqueue` (Task 2), `resolveAutodraftChannel` (Task 1, de
  `@opsmind/shared-types`).
- Produces: nenhuma interface nova pra fora — `score()` mantém a mesma assinatura pública
  (`score(organizationId: string, id: string, actorUserId: string): Promise<Lead>`).

- [ ] **Step 1: Escrever os 7 testes novos em `leads.service.spec.ts`, dentro de `describe('score', ...)`**

Seguir o padrão de mock já usado nos testes existentes de `score()` neste arquivo (mock de
`prisma.lead.update`, `prisma.serviceOffering.findMany`, etc. — ver os testes já existentes em torno da
linha 407 em diante). Adicionar mocks de `prisma.outreachMessage.count`, `prisma.leadSignal.count`, e dos
dois queue services injetados (`jest.fn()` resolvendo/rejeitando conforme o caso). Casos:

```ts
it('lead cruza pra QUALIFIED com site nunca investigado: enfileira website-profile, não outreach-autodraft', async () => {
  // prisma.leadSignal.count resolve 0; lead tem website; score cruza o threshold;
  // suggestedOfferingId presente; outreachMessage.count resolve 0
  // assert: websiteProfileQueueService.enqueue chamado com { organizationId, leadId: id, actorType: 'USER', actorId: actorUserId }
  // assert: outreachAutodraftQueueService.enqueue NÃO chamado
});

it('lead cruza pra QUALIFIED com site já investigado e whatsapp preenchido: enfileira outreach-autodraft com canal WHATSAPP, não website-profile', async () => {
  // prisma.leadSignal.count resolve 1 (já investigado); lead.whatsapp preenchido
  // assert: outreachAutodraftQueueService.enqueue chamado com { organizationId, leadId: id, channel: 'WHATSAPP', serviceOfferingId }
  // assert: websiteProfileQueueService.enqueue NÃO chamado
});

it('lead cruza pra QUALIFIED sem site, com email preenchido: enfileira outreach-autodraft com canal EMAIL', async () => {
  // lead.website null; lead.email preenchido
  // assert: outreachAutodraftQueueService.enqueue chamado com channel: 'EMAIL'
});

it('lead cruza pra QUALIFIED sem suggestedOfferingId: não enfileira nada', async () => {
  // breakdown.matchedOfferingId undefined/null
  // assert: nenhum dos dois enqueue chamado
});

it('lead já tem um OutreachMessage existente: não enfileira nada mesmo cruzando pra QUALIFIED agora', async () => {
  // prisma.outreachMessage.count resolve 1
  // assert: nenhum dos dois enqueue chamado
});

it('lead permanece em status que canUpdateStatus não altera (ex.: já CONVERTED): não enfileira nada', async () => {
  // lead.status inicial 'CONVERTED' (fora de PRE_QUALIFICATION_STATUSES)
  // assert: nenhum dos dois enqueue chamado
});

it('falha ao enfileirar não propaga: score() ainda retorna o lead atualizado normalmente', async () => {
  // websiteProfileQueueService.enqueue mockado pra rejeitar
  // act: const result = await service.score(...)
  // assert: result é o lead atualizado (sem throw)
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham** (a lógica ainda não existe em `score()`)

Run: `pnpm --filter api test -- leads.service.spec -t score`
Expected: FAIL nos 7 casos novos (comportamento ainda não implementado)

- [ ] **Step 3: Implementar a bifurcação em `LeadsService.score()`**

No constructor (linha ~94-99), adicionar `private readonly websiteProfileQueueService: WebsiteProfileQueueService`
e `private readonly outreachAutodraftQueueService: OutreachAutodraftQueueService`. Dentro de `score()`,
depois do `auditService.log` existente (linha ~443) e antes do `return updated` (linha ~445):

```ts
if (canUpdateStatus && computedStatus === 'QUALIFIED' && updated.suggestedOfferingId) {
  try {
    const existingOutreachCount = await this.prisma.outreachMessage.count({ where: { leadId: id } });
    if (existingOutreachCount === 0) {
      const alreadyInvestigated = updated.website
        ? (await this.prisma.leadSignal.count({ where: { leadId: id } })) > 0
        : false;
      if (updated.website && !alreadyInvestigated) {
        await this.websiteProfileQueueService.enqueue({
          organizationId, leadId: id, actorType: 'USER', actorId: actorUserId,
        });
      } else {
        const channel = resolveAutodraftChannel(updated);
        if (channel) {
          await this.outreachAutodraftQueueService.enqueue({
            organizationId, leadId: id, channel, serviceOfferingId: updated.suggestedOfferingId,
          });
        }
      }
    }
  } catch (error) {
    // best-effort — ver Global Constraints do plano; nunca derruba score() já persistido com sucesso.
  }
}
```

(Ajustar nomes de import: `resolveAutodraftChannel` de `@opsmind/shared-types`, os dois queue services dos
seus respectivos arquivos em `../../infrastructure/queue/`.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter api test -- leads.service.spec -t score`
Expected: PASS nos 7 casos novos + todos os casos já existentes de `score()` continuam passando

- [ ] **Step 5: Rodar a suíte completa de `leads.service.spec.ts`**

Run: `pnpm --filter api test -- leads.service.spec`
Expected: PASS (todos os `describe` do arquivo, não só `score`)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/leads/leads.service.ts apps/api/src/modules/leads/leads.service.spec.ts
git commit -m "feat(api): LeadsService.score() dispara investigação/autodraft ao qualificar um lead (Harvey Fase 7)"
```

---

### Task 4: Cobertura e2e mínima

**Files:**
- Modify: `apps/api/test/leads.e2e-spec.ts`

**Interfaces:**
- Consumes: endpoint real `POST .../leads/:id/score` já existente; acesso direto à fila `website-profile`
  via BullMQ `Queue` apontando pro Redis de teste (mesma `REDIS_URL` do `.env` de teste).

- [ ] **Step 1: Escrever o teste novo**

```ts
it('POST /leads/:id/score que qualifica um lead com site nunca investigado enfileira um job real em website-profile', async () => {
  // arrange: criar organização/usuário/lead via helpers já existentes no arquivo, lead com website preenchido
  //          e dados que cruzam o threshold de qualificação (reaproveitar fixture de outro teste de score() deste arquivo)
  // act: POST .../leads/:id/score
  // assert: response 200/201
  // assert: usando uma instância de bullmq.Queue('website-profile', { connection: <redis de teste> }),
  //         getJobs(['waiting','active']) contém um job com data.leadId === lead.id
  //         (fechar a Queue no final do teste, mesmo padrão de outros testes que abrem conexão direta)
});
```

- [ ] **Step 2: Rodar o teste isoladamente e confirmar que passa** (precisa Postgres+Redis up)

Run: `pnpm --filter api test:e2e -- leads -t "enfileira um job real"`
Expected: PASS

- [ ] **Step 3: Rodar a suíte e2e completa de leads**

Run: `pnpm --filter api test:e2e -- leads`
Expected: PASS (nenhum teste existente quebrou)

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/leads.e2e-spec.ts
git commit -m "test(api): e2e cobrindo o gatilho real de website-profile ao qualificar um lead via score()"
```
