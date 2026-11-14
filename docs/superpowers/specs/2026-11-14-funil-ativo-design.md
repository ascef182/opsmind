# Funil ativo: radar de risco, gatilhos de automação e Kanban arrastável

## Intenção e porquê

Investigamos um concorrente (IARecepcionist/deskcomm-crm) buscando ideias pra melhorar o OpsMind.
Três delas foram escolhidas pelo usuário para desenhar agora:

1. **Radar de risco por etapa + reativação automática** — hoje um Deal pode ficar parado
   indefinidamente em qualquer etapa sem que ninguém seja avisado. O concorrente mede isso contra
   um tempo esperado *por etapa* (não um número fixo pra todo o pipeline) e cria uma tarefa de
   reativação automaticamente quando o deal "esfria".
2. **Gatilhos de automação sobre o funil** — o motor de Automations do OpsMind hoje só tem um
   trigger (`CUSTOMER_INACTIVE`). Faltam gatilhos equivalentes para Deal parado/sem resposta.
3. **Kanban arrastável** — a tela de Deals já agrupa os cards por etapa em colunas, mas a
   transição de etapa é feita por um `<Select>` no card, não por arrastar. É a diferença de UX
   mais perceptível no dia a dia de quem usa.

As três são sobre a mesma coisa — Deal parado numa etapa — então o mesmo sinal de "tempo na
etapa atual" alimenta as três.

## Goals

- Saber, sem abrir cada Deal, quais estão em risco de esfriar — com um critério auditável (nunca
  um "score de IA" opaco), mesmo espírito do `scoreLead()` já existente.
- Criar automaticamente uma tarefa de reativação quando um Deal cruza o limiar de tempo parado,
  sem depender de um humano lembrar de verificar.
- Deixar a organização configurar esse gatilho (dias, ações) pelo mesmo motor de Automations que
  já existe — não um sistema paralelo.
- Deal mudar de etapa arrastando o card entre as colunas já existentes da tela de Deals.

## Non-goals (v1)

- **Rascunho de mensagem de reativação escrito por IA automaticamente.** O concorrente faz isso
  (worker cria a tarefa com rascunho vazio, IA preenche depois). Fica fora do v1: a tarefa de
  reativação nasce com um texto determinístico ("Negócio X parado há N dias na etapa Y"), sem
  IA — evita reabrir a mesma discussão de orçamento/latência de IA que já existe em 4 outros
  lugares do código. Pode entrar depois como uma ação adicional da automação, se fizer sentido.
- **Etapas de pipeline configuráveis por organização.** `DealStage` continua um enum fixo
  (`QUALIFICATION/PROPOSAL/NEGOTIATION/CONTRACT_SENT/WON/LOST`) — não vamos replicar a tabela
  `crm_stages` dinâmica do concorrente. O tempo esperado por etapa é uma constante por enum, não
  configurável por org no v1.
- **Reordenar livremente dentro da mesma coluna.** O concorrente tem indexação fracionária pra
  ordenar cards dentro da etapa; aqui, arrastar só move entre colunas (muda a etapa), a ordem
  dentro da coluna continua sendo a ordenação atual (ex.: por data).
- **Financeiro automático ao ganhar negócio** (a 4ª ideia do brainstorm) — não foi escolhida
  agora, fica de fora deste design.

## Anti-goals

- Nunca criar uma segunda forma de mudar o estágio de um Deal que não passe por
  `DealsService.moveStage()` — a validação de transição (`DEAL_STAGE_TRANSITIONS`) e o motivo
  obrigatório em `LOST` continuam sendo a única porta, tanto pelo Select quanto pelo drag.
- Nunca calcular risco/tempo-parado com uma chamada de IA — tem que ser uma função pura,
  testável sem gateway nenhum, igual `scoreLead()`.

## Constraints (confirmadas no código)

- `DealStage` é enum fixo (`packages/database/prisma/schema.prisma:479-486`), não uma tabela.
- `AutomationTrigger` também é enum fixo, hoje só `CUSTOMER_INACTIVE`
  (`schema.prisma:75-79`) — comentário no próprio enum já prevê crescer "conforme surgir
  necessidade real".
- `Automation.actions`/`conditions` são `Json` livre, interpretados por trigger no
  `apps/worker/src/automation-processor.ts` — hoje só existe `CustomerInactiveActions`
  (`createTask`/`notify`). Cada trigger tem seu próprio shape de actions, não um vocabulário
  genérico — seguir o mesmo padrão.
- `Task` só tem `customerId` (nullable), não `dealId` — todo `Deal` já tem `customerId`
  obrigatório, então a tarefa de reativação linka pelo customer do deal, referenciando o deal
  pelo nome/id no título/descrição (sem precisar de migration no `Task`).
- `OutreachMessage` é estrutura de prospecção fria (exige `leadId`, `evidenceQuotes` de score de
  lead) — não serve e não deve ser reaproveitada pra reativação de Deal. Se um dia quisermos o
  rascunho de IA (fora do v1), é uma estrutura nova, não essa.
- A tela de Deals (`apps/web/app/organizations/[organizationId]/deals/page.tsx`) já agrupa cards
  por `DealStage` em colunas (`DEAL_STAGES.map(...)`, linha ~229) — só falta o drag.
- `apps/web/package.json` não tem nenhuma lib de drag-and-drop hoje.

## Decisões de "como" (minhas, documentadas aqui — não perguntadas)

1. **Novo campo `Deal.stageEnteredAt: DateTime`**, atualizado só em `DealsService.moveStage()`
   quando o estágio de fato muda (nunca em outros updates do Deal) — é o sinal exato de "tempo na
   etapa atual", mais preciso que usar `updatedAt` (que muda em qualquer edição). Migration nova,
   backfill com `createdAt` pra deals existentes.
2. **`DEFAULT_EXPECTED_STAGE_DURATION_HOURS: Record<DealStage, number>`** em
   `packages/shared-types/src/deal-risk.ts` (novo arquivo) — constantes razoáveis por etapa
   (ex.: QUALIFICATION 72h, PROPOSAL 120h, NEGOTIATION 168h, CONTRACT_SENT 72h; WON/LOST não
   aplicável). Função pura `computeDealRisk(deal, now)` retorna um bucket
   (`ON_TRACK | COOLING | AT_RISK | NOT_APPLICABLE`) comparando `now - stageEnteredAt` contra o
   limiar da etapa — `NOT_APPLICABLE` sempre que `deal.stage` for `WON`/`LOST`, pra função ficar
   total sobre todo `DealStage` (nenhum call site precisa filtrar antes de chamar) — nunca
   persistido, calculado on-the-fly (na listagem de Deals e no scan de automação).
3. **Dois novos valores em `AutomationTrigger`**: `DEAL_STAGE_STALE` (tempo na etapa atual
   excede o limiar — usa `computeDealRisk`) e `DEAL_SILENT_FOR` (nenhuma `ActivityLog` nova do
   customer do deal há N dias configurável — reaproveita `ActivityLog` já existente, não cria
   tabela nova). Mesmo padrão de scan periódico de `CUSTOMER_INACTIVE`
   (`apps/worker/src/automation-scan.ts`).

   **Dedup por Deal, não por Customer** (achado pela revisão do builder-check: nada no schema
   impede um Customer ter mais de um Deal aberto ao mesmo tempo — `AutomationRun` hoje só tem
   `customerId`, suficiente pro dedup de `CUSTOMER_INACTIVE` porque esse trigger é inerentemente
   por customer, mas insuficiente aqui: dois Deals do mesmo customer esfriando em momentos
   diferentes não podem compartilhar o mesmo registro de dedup, ou o segundo nunca dispararia).
   `AutomationRun` ganha uma coluna nova, nullable, `dealId` — preenchida só pelos dois triggers
   novos (`CUSTOMER_INACTIVE` continua exatamente como está, sem tocar nela). O dedup desses dois
   triggers passa a ser `(automationId, dealId, status='SUCCESS', createdAt > deal.stageEnteredAt)`
   em vez de por customer. `AutomationExecutionJobData` (`packages/shared-types/src/automation.types.ts`)
   ganha um campo `dealId?: string` pelo mesmo motivo — é o que permite a Task de reativação citar
   o Deal certo pelo nome, não só "o customer X tem algo parado".

   **Limiar configurável por automação, não por organização de forma geral** (resolvendo uma
   tensão que o builder-check pegou entre Goals e Non-goals): `DEAL_STAGE_STALE.conditions` aceita
   um `thresholdHoursOverride?: number` opcional — quando ausente, usa
   `DEFAULT_EXPECTED_STAGE_DURATION_HOURS[deal.stage]`; quando presente, sobrescreve só pra aquela
   automação específica. Mesmo padrão que `CUSTOMER_INACTIVE.conditions.inactiveForDays` já usa
   pra sobrescrever o default da organização. Isso NÃO é a tabela de etapas configuráveis do
   concorrente (continua fora do v1) — é só o mesmo mecanismo de override por automação que já
   existe pro outro trigger, aplicado aqui.
4. **Actions do novo trigger** (`DealStaleActions`, mesmo padrão de `CustomerInactiveActions`):
   `createTask` (cria a Task determinística linkada ao customer) e `notify` (notifica o owner do
   deal) — sem ação de IA no v1 (ver Non-goals).
5. **Drag-and-drop**: biblioteca `@hello-pangea/dnd` (fork mantido do react-beautiful-dnd, mesma
   que o concorrente usa, API estável). `onDragEnd` chama exatamente `DealsService` via o hook
   `useMoveDealStage` que já existe — só valida `DEAL_STAGE_TRANSITIONS` antes de disparar (mesma
   regra que o Select já aplica) e, se o destino for `LOST`, abre o mesmo prompt de motivo que já
   existe hoje antes de confirmar o drop.
6. Badge visual de risco no card do Deal (cor/ícone por bucket de `computeDealRisk`) — reaproveita
   a mesma função pura, não é um sinal novo.

## O que fica para quem implementar

- Valores exatos de `DEFAULT_EXPECTED_STAGE_DURATION_HOURS` por etapa — os citados acima são
  ponto de partida razoável, ajustáveis durante a implementação sem mudar o design.
- Texto exato do título/descrição da Task de reativação determinística.
- Detalhe de UX do drag (placeholder/animação) — qualquer biblioteca madura resolve isso,
  não é uma decisão de produto.
- Se `DEAL_SILENT_FOR` deve considerar só `ActivityLog`, ou também `OutreachMessage.sentAt`/
  `repliedAt` do customer (se o customer também for um Lead convertido) — decisão de implementação,
  não muda o shape do trigger.

## Verificação

- `computeDealRisk`/`DEFAULT_EXPECTED_STAGE_DURATION_HOURS`: testes unitários puros (vários
  tempos parados × etapa → bucket esperado), mesmo padrão de `lead-scoring.spec.ts`.
- Novo scan de automação: specs em `apps/worker/src/automation-scan.spec.ts`/
  `automation-processor.spec.ts` espelhando os existentes de `CUSTOMER_INACTIVE` (dedup, condição
  deixando de bater entre enfileirar e processar, etc.).
- e2e: criar Deal, forçar `stageEnteredAt` pro passado, rodar o scan, confirmar Task criada uma
  única vez mesmo em duas passadas.
- Web: testar manualmente arrastar um card entre colunas válidas e para uma coluna inválida
  (deve recusar), e o fluxo de LOST com motivo obrigatório continuando a funcionar.
