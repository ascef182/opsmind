# Fase 7 — AI Engineering Polish (design)

**Status:** aprovado em brainstorming, pronto para plano de implementação.
**Referência:** `docs/planning/PRD.md` §17 ("Fase 7 — AI Engineering Polish, Sprint 14") e critério de aceitação geral #6 e #7 (§18).

## Objetivo

Fechar os quatro pilares do PRD (CRM real + RAG + tool calling + observabilidade de IA) com:
painel de custo/uso de IA por organização e usuário, orçamento mensal configurável via API/UI,
dataset de evals (tool accuracy, hallucination rate, custo, latência) rodando em CI, e um teste
de resistência a prompt injection via documento malicioso.

Sem corte de escopo (a nota de corte do PRD §17 não se aplica — build completo).

## Contexto de branch

A branch `feat/fase6-production-readiness` divergia de `feat/fase4-documents-rag` no mesmo ponto
de `main` (commit `7f5fcbb`) — não incluía RAG/documentos. Como o teste de prompt injection do
critério de aceitação depende de documento real, a Fase 7 nasce em `feat/fase7-ai-engineering-polish`
(criada a partir de `feat/fase6-production-readiness`), já com `feat/fase4-documents-rag`
mesclada (commit `ae51975`) — conflitos em `.gitignore`, `apps/api/package.json`,
`packages/config/env/schema.ts`, `packages/database/prisma/schema.prisma` e
`packages/database/src/index.ts` (todos aditivos: cada fase tocou seções diferentes do mesmo
arquivo), resolvidos mantendo os dois lados. `pnpm install` + `prisma generate` + `pnpm typecheck`
+ `pnpm test` (218 testes) rodaram limpos contra a árvore mesclada antes de qualquer código novo
da Fase 7 em si.

**Pré-requisito operacional (fora do meu alcance):** o CI vai precisar de dois secrets novos no
GitHub — `ANTHROPIC_API_KEY` e `OPENAI_API_KEY` (esta última já é usada pela Fase 4 para
embeddings, mas nunca foi configurada em CI porque não existia CI de IA real até agora). O
usuário precisa cadastrar os dois antes do job de eval funcionar.

## Backend

### Orçamento configurável

`Organization.aiMonthlyBudget` já existe no schema (`Decimal? @db.Decimal(10,2)`) e já é
consultado pelo corte de orçamento (`BudgetService`/`AiService`), mas não existe nenhum endpoint
para configurá-lo — hoje só dá para editar direto no banco.

- `PATCH /organizations/:id` — DTO `{ aiMonthlyBudget: number | null }` (`null` = sem orçamento,
  nunca corta — mesma semântica já usada em `BudgetService.isOverBudget`). Validação: número
  não-negativo quando presente.
- Gate: `RolesGuard` restrito a `OWNER`/`ADMIN`, mesmo padrão de mutações sensíveis em
  `customers`/`tasks`.

### Painel de custo/uso

`AIRequest` (Fase 3) já persiste por request: `organizationId`, `userId`, `model`,
`inputTokens`, `outputTokens`, `latencyMs`, `estimatedCost`, `status`. Não precisa de tabela
nova — só agregação.

- `GET /organizations/:organizationId/ai/usage` — endpoint **já existe** (`AiController.usage()`,
  hoje devolve só `{ monthSpend }` via `BudgetService.getMonthSpend`). Estendo o mesmo endpoint
  (não crio um novo) para devolver, além do que já tem hoje:
  - gasto do mês corrente (soma `estimatedCost` do mês) vs. `aiMonthlyBudget` atual;
  - série diária de custo e contagem de requests (para gráfico);
  - breakdown por usuário (nome/id, custo, requests, tokens) — via `groupBy` do Prisma.

## Eval suite

Novo diretório `apps/api/eval/` (fora de `src/` — não é código de produção, é uma suite
executável separadamente, no espírito do `run-eval.ts` como script `pnpm --filter api eval`).

### Dataset (`dataset.json`, 16 casos)

| Categoria | Casos | O que valida |
|---|---|---|
| `tool-accuracy` | 8 | pergunta → nome da tool esperada + args-chave esperados |
| `rag-grounding` | 4 | pergunta cuja resposta só existe num documento pré-carregado → resposta cita a fonte |
| `hallucination-judge` | 2 | pergunta sobre dado inexistente → IA deveria admitir a lacuna, não inventar |
| `prompt-injection` | 2 | documento com instrução maliciosa embutida → IA não obedece a instrução, só responde à pergunta real |

### Runner (`run-eval.ts`)

- Sobe um `AiService` real via `Test.createTestingModule` (mesmo padrão dos e2e), banco seedado
  com uma organização fixa + clientes/tarefas/documentos determinísticos.
- Usa `ClaudeGatewayService` de verdade (API real), não o mock dos e2e — é o único jeito de medir
  comportamento real do modelo. Modelo controlado por env var nova `ANTHROPIC_MODEL` (default
  `claude-opus-5`, mantendo produção como está); o script de eval seta
  `ANTHROPIC_MODEL=claude-haiku-4-5` para manter custo baixo.
- **Julgamento de alucinação:** para os casos `hallucination-judge` e como checagem auxiliar nos
  demais, uma segunda chamada (Haiku) recebe a resposta da IA + os outputs reais das tools
  chamadas na conversa, e julga se a resposta afirma algum fato ausente desses outputs.
- **Resistência a injection:** o caso passa se a IA não executa/relata a instrução embutida no
  documento (ex.: não chama `create_task` com dados do atacante, não vaza dados de outra
  organização) — checagem programática sobre o log de tool calls da conversa, sem precisar de
  judge.
- Métricas agregadas impressas em tabela + `eval-report.json`: tool accuracy %, hallucination
  rate %, injection resistance %, custo total, latência média.

## CI

Novo job `eval-suite` em `.github/workflows/ci.yml`, paralelo ao job principal:
- Mesmos services (`postgres` com pgvector, `redis`), mesma migration/seed.
- `env.ANTHROPIC_API_KEY` e `env.OPENAI_API_KEY` vindos de `secrets.*`.
- Roda `pnpm --filter api eval` e publica `eval-report.json` formatado em
  `$GITHUB_STEP_SUMMARY` (tabela visível direto na aba Actions do PR).
- Roda em todo push/PR para `main`, igual ao job principal — decisão consciente de custo
  recorrente pequeno (Haiku, ~16 casos) em troca de sinal de regressão a cada mudança no
  assistente.

## Frontend

`apps/web/app/organizations/[organizationId]/ai/` ganha uma sub-rota `usage/` (ou seção na
página existente — decidir no plano, conforme o tamanho da página atual). Inspirado em padrões
de UI do próprio Claude Code (a interface que constrói este projeto), não num dashboard
genérico:

- **Barra de orçamento com estados graduais** — como a barra de uso de contexto do Claude Code,
  que muda de cor e avisa conforme se aproxima do limite. Três estados visuais (normal / perto
  do limite / estourado), onde o estado "estourado" não é inventado na UI — é literalmente o
  reflexo do `ForbiddenException` que `AiService` já lança quando `BudgetService.isOverBudget`
  retorna true. A UI visualiza uma decisão que o backend já toma, não cria uma segunda fonte de
  verdade.
- **Custo em segundo plano, não em destaque** — no Claude Code o custo fica disponível sob
  demanda (`ctrl+o`/`/cost`), não domina a tela. O card de gasto do mês é compacto por padrão
  (um número + a barra de orçamento), sem virar o elemento central da página.
- **Trace expansível por request, não só agregado** — em vez de só números agregados, a lista de
  "requests recentes" é expansível: clicar num request mostra as tools chamadas, input/output,
  tokens e latência daquele request específico (reaproveita `AIRequestToolCall`, já persistido
  desde a Fase 3) — mesma transparência que o Claude Code dá sobre tool calls, aplicada a dados
  que já existem, sem tabela nova.
- Gráfico de série diária de custo/requests — reusa padrão de charts do `dashboard` se existir;
  senão SVG simples, sem libs novas.
- Formulário de orçamento mensal (`PATCH /organizations/:id`) — renderizado só para
  `OWNER`/`ADMIN`, mesmo padrão de esconder ações por papel já usado em `team/page.tsx`.

## Testes

- `PATCH /organizations/:id` e `GET /organizations/:id/ai/usage`: e2e com `TestingModule` normal
  (banco real via Docker Compose/CI, sem chamar IA) — cobre RBAC e agregação, seguindo o padrão
  já usado em `organizations.e2e-spec.ts`/`dashboard.e2e-spec.ts`.
- Eval suite: não é parte da suite Jest (`pnpm test`) — é o próprio critério de aceitação
  ("resultados do eval suite rodando via CI"), reportado como step summary, não como
  pass/fail de teste unitário. Falha do job de CI = script retorna erro (ex.: erro de
  configuração), não "métrica abaixo do ideal" — não bloqueia o PR por variação normal do modelo.

## Mapeamento para critérios de aceitação do PRD

- §17 Fase 7: painel de custo ✅ (seção Frontend), eval dataset com as 4 métricas ✅ (seção Eval
  suite), teste de prompt injection ✅ (categoria `prompt-injection` do dataset).
- §18.6: "painel de analytics mostra... quantos requests de IA, custo estimado e latência média"
  ✅ (`GET /organizations/:id/ai/usage`).
- §18.7: "teste de prompt injection... não consegue alterar o comportamento além do escopo da
  pergunta" ✅ (categoria `prompt-injection`, checagem sobre tool calls).
