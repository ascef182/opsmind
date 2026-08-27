# OpsMind — Plano de Desenvolvimento Sintetizado (pós-rodada de planejamento com agentes ECC)

**Data:** 2026-08-26
**Método:** 7 subagentes do repositório [ECC](https://github.com/affaan-m/ECC) (`architect`, `planner`, `code-architect`, `database-reviewer`, `security-reviewer`, `rag-pipeline-reviewer`, `agent-evaluator`), cada um lendo o PRD completo (`docs/planning/PRD.md`) de forma independente e produzindo um parecer pela sua especialidade. Pareceres completos em [`docs/planning/reviews/`](./reviews/).
**Natureza:** este documento é a síntese — decisões recomendadas, não decisões tomadas. Os itens marcados "Decisão do usuário" na seção 7 precisam de confirmação antes de virarem trabalho.

---

## 1. Veredito geral

O PRD é sólido na decisão estrutural mais importante — **monolito modular em vez de microsserviços prematuros** — e todos os 7 agentes concordam que essa base não precisa ser revisitada. Os 7 pareceres, lidos em conjunto, não geraram nenhuma contradição real entre si; são majoritariamente complementares, e em três pontos **convergiram de forma independente para o mesmo achado**, o que é o sinal mais forte de que algo precisa ser corrigido antes da Fase 1 começar:

| Achado convergente | Quem achou |
|---|---|
| `DocumentChunk` e `AutomationRun` sem `organization_id` próprio — quebra a regra de isolamento multi-tenant da seção 8 do PRD | `architect`, `database-reviewer`, `security-reviewer` (C1) |
| Isolamento de tenant descrito como intenção ("idealmente reforçado"), não como garantia estrutural — falta camada de banco (RLS), não só guard de aplicação | `architect` (R3), `database-reviewer` (1.3), `security-reviewer` (C2) |
| Faltam entidades `Invitation`/`RefreshToken`/`EmailVerificationToken` e configuração `inactive_after_days` por organização — a Fase 1 não é implementável sem elas, mas não estão na seção 9 do PRD | `database-reviewer` (4.8, 4.9), `code-architect` (já as adicionou no blueprint como extensão justificada) |
| Testes de prompt injection/evals chegam tarde demais (Sprint 14) em relação a quando os módulos de risco (IA, RAG) entram em produção (Sprints 6–10) | `planner`, `security-reviewer` (A7), `agent-evaluator`, `rag-pipeline-reviewer` |

Nenhum desses pontos exige abandonar nenhuma decisão de arquitetura do PRD — são lacunas de especificação, corrigíveis agora a baixo custo (a maioria é schema/ADR, não código).

---

## 2. Correções obrigatórias no modelo de dados (antes da primeira migration)

Consolidando `database-reviewer` + `security-reviewer` + `code-architect`:

1. **Adicionar `organization_id` denormalizado** em `DocumentChunk` e `AutomationRun` (copiado do pai no `INSERT`, `NOT NULL`, FK, nunca derivado por join). Sem isso a busca vetorial do RAG não consegue filtrar por tenant de forma eficiente nem seguramente — é o vetor mais provável de vazamento cross-tenant via IA (caso de uso 7 do PRD).
2. **Adicionar `deleted_at timestamptz`** em `Customer` e `Document` — o PRD já exige soft-delete (seção 8), mas o campo não existe no modelo.
3. **Adicionar entidade `Invitation`** (`id, organization_id, email, role, token_hash, status, invited_by_user_id, expires_at, accepted_at`) — já implementada no blueprint do `code-architect`. Sem ela não há onde representar um convite pendente antes da pessoa convidada ter conta.
4. **Adicionar `RefreshToken` e `EmailVerificationToken`** como entidades de suporte de auth — idem, já no blueprint do `code-architect`.
5. **Adicionar `inactive_after_days int DEFAULT 14`** em `Organization` — a regra de negócio já diz "configurável por organização, padrão 14 dias" mas não há onde configurar.
6. **Adicionar `embedding_model` em `DocumentChunk`** — caro de reconstruir depois se o modelo de embedding mudar.
7. **Substituir o padrão de "ator livre"** (`ActivityLog.actor`, `Task.created_by`, `AutomationRun.triggered_by`) por `actor_type` + `actor_id`, replicando o padrão já correto de `AuditLog`.
8. **Ampliar `AIRequest`** com `session_id`/`conversation_id`, `retrieved_chunk_ids` (ou tabela relacional), `status`, `error_message`, e normalizar `tool_calls[]` numa tabela `AIRequestToolCall` — sem isso não dá para medir retrieval accuracy nem reconstruir uma sessão para o dashboard. Precisa entrar **na Fase 3**, não como retrofit na Fase 7.
9. **Tipos:** `numeric` (nunca `float`) para `estimated_cost`/`ai_monthly_budget`; `timestamptz` em todos os timestamps; `jsonb` (não array escalar) para `tool_calls`.
10. **Índices desde o dia 1** (lista completa em `reviews/database-reviewer-review.md`, seção 2) — destaque para `(organization_id, last_activity_at)` em `Customer` (a query de inatividade é o caso de uso #1 do PRD) e índice HNSW em `DocumentChunk.embedding`.

---

## 3. Decisões de arquitetura a travar via ADR curto (antes da Fase 3)

| Decisão | Recomendação consolidada | Quem levantou |
|---|---|---|
| Execução de tools de IA: síncrona ou via fila? | **Síncrona** dentro do handler de `/ai/chat`; fila `ai-tool-execution` só para `persist-audit-log` (fire-and-forget). O PRD hoje descreve os dois modelos sem reconciliar. | `architect` (R2) |
| Processo de worker separado do zero | Reservar `apps/worker` no monorepo desde a Fase 1 (mesmo vazio), para a "extração futura" prometida na seção 10.1 do PRD ser real (escalar réplica) e não um refactor no Sprint 13. `code-architect` já inclui Redis no `docker-compose` desde o Passo 0 por esse motivo. | `architect` (R1), `code-architect` |
| Enforcement de tenant | Duas camadas: Prisma Client Extension (obrigatório, injeta `organization_id`) **+** Postgres Row-Level Security nas tabelas mais sensíveis (`Customer`, `Document`, `DocumentChunk`, `AuditLog`) como defesa em profundidade — cobre workers/scripts/queries raw que o guard de aplicação não alcança. | `architect`, `database-reviewer`, `security-reviewer` (C2) |
| Sessão/JWT multi-organização | Access token **sem** `organization_id`/`role` embutidos; `TenantGuard` resolve a `Membership` por request. Troca de organização = endpoint dedicado que reemite token. Isso já resolve, por desenho, o risco de token "cross-tenant" (architect R9) e de revogação tardia de papel (security A2). | `architect` (R9), `security-reviewer` (A2, C4) — **já implementado no blueprint do `code-architect`** |
| Tools de IA nunca aceitam `organization_id`/`user_id` como argumento do modelo | Todo valor de identidade/tenant é injetado pelo executor de tools a partir da sessão autenticada; qualquer valor equivalente vindo do modelo é ignorado, nunca mesclado. | `security-reviewer` (C3) — crítico, ligado diretamente ao caso de uso 7 do PRD |
| Orçamento de IA: MVP ou pós-MVP? | O PRD tem uma inconsistência real: caso de uso #5 promete corte de orçamento, seção 6 (MVP) só entrega visibilidade, seção 7 (pós-MVP) lista o corte automático. Recomendação: implementar já no MVP um corte **síncrono simples** (contador Redis por org/mês, comparado a `ai_monthly_budget` antes de cada chamada) — não precisa do painel de alertas completo da Fase 7. | `architect` (R10), `security-reviewer` (A5) |

---

## 4. Fase 1 (Sprints 1–2) — plano de execução consolidado

O `planner` quebrou a Fase 1 em 18 issues; o `code-architect` produziu um blueprint completo de arquivos/schema/ordem de build; o `security-reviewer` produziu um checklist de segurança específico da Fase 1. Os três se encaixam sem conflito — a ordem de build do `code-architect` é mais granular e é a que deve guiar a implementação; os itens de segurança e as issues do `planner` mapeiam para os passos abaixo.

### Ordem de build (via `code-architect`, com issues do `planner` e itens de segurança mapeados)

```
Passo 0  Monorepo + Docker Compose (Postgres+pgvector, Redis) + env schema Zod
         └─ Marco: docker compose up sobe tudo saudável
Passo 1  packages/database — schema Prisma completo (seção 2 deste doc) + migration inicial
         └─ Marco: prisma migrate dev roda limpo
Passo 2  Bootstrap apps/api — PrismaModule, GET /health
         └─ Marco: primeira prova ponta a ponta Docker→Prisma→Nest
Passo 3  shared/ (decorators base, ROLE_HIERARCHY) — sem lógica de auth ainda
Passo 4  modules/users (mínimo)
Passo 5  modules/auth — register/login/refresh/logout, Argon2id, JWT 15min + refresh
         com rotação, rate limiting (@nestjs/throttler) em /auth/* desde já
         └─ Marco: fluxo completo via curl (register→login→rota protegida→refresh→logout)
Passo 6  modules/audit — AuditService.log() central, plugado no auth
         └─ Marco: registro gera linha em audit_logs
Passo 7  modules/organizations — criação + Membership(OWNER) automático
         └─ Marco: usuário cria org e vira OWNER
Passo 8  TenantGuard + RolesGuard (dependem de organizations existir)
Passo 9  modules/memberships — invite (expira 7d) / accept / list / update role / remove
         + EmailService stub (log no console em dev)
         └─ Marco: FECHA o critério de aceitação da Fase 1 —
            A cria org → convida B como MEMBER → B aceita → GET /audit-logs mostra tudo
Passo 10 Testes e2e (auth + fluxo org/invite/audit) + unit tests de regras de negócio
Passo 11 CI mínimo (lint+typecheck+test) + esqueleto apps/web (baixa prioridade,
         mas evita retrabalho de config na Fase 2)
```

Schema Prisma completo, lista de arquivos por passo e todas as decisões de design (14 decisões documentadas, ex.: por que `AuditLog.organizationId` é nullable, por que não há repository layer) estão em `reviews/code-architect-review.md` — recomendo usá-lo diretamente como referência de implementação do Sprint 1, não reescrever do zero.

### Checklist de segurança da Fase 1 (via `security-reviewer`, resumido — lista completa no review)

- [ ] `organization_id` obrigatório desde já em `DocumentChunk`/`AutomationRun` mesmo esses módulos só chegando nas Fases 3–5 (evita migration dolorosa depois)
- [ ] RLS habilitada nas tabelas sensíveis + teste de CI que prova isolamento cross-tenant direto contra o banco (não só via API)
- [ ] Refresh token: rotação a cada uso + detecção de reuso (revoga família inteira)
- [ ] Revogação de sessão em: logout, troca de senha, remoção de membership, mudança de papel
- [ ] `switch-organization` como endpoint dedicado que reemite token — nunca aceitar `organization_id` de header/param do cliente
- [ ] Regra de convite: só Owner/Admin convidam, nunca com papel ≥ ao do convidador (evita Manager convidando Owner)
- [ ] `AuditLog` append-only a nível de permissão de banco (papel de aplicação sem `UPDATE`/`DELETE`)
- [ ] Rate limiting em `/auth/login`, `/auth/register`, `/auth/refresh` desde o Sprint 1 (não esperar a Fase 6)
- [ ] Validação de input (Zod/class-validator) em 100% dos DTOs desde o primeiro endpoint

### Issues adicionais do `planner` não cobertas acima

- **CI mínimo (lint+typecheck+test) movido para a Fase 1** — já refletido no Passo 11.
- **Seed script de dados de desenvolvimento** (`pnpm seed`) — org de demo + usuários nos 5 papéis, para não recriar dados manualmente a cada fase.
- **Estimativa total da Fase 1: ~80–90h**, perto do teto de capacidade de 2 sprints part-time (60–100h) — o `planner` recomenda **não adicionar escopo além do descrito acima** para não estourar o sprint.

---

## 5. Ajustes recomendados no roadmap (seção 17 do PRD)

Do parecer do `planner`, confirmado por outros agentes onde aplicável:

1. **Mover CI mínimo e rate limiting de auth para a Fase 1** (já refletido na seção 4).
2. **Antecipar uma baseline de eval de RAG para dentro da Fase 4** (Sprints 9–10), em vez de esperar a Fase 7 — a Fase 4 já promete "resposta correta com citação" como critério de aceitação sem nenhuma forma objetiva de medir isso antes da Fase 7. Recomendação do `rag-pipeline-reviewer` e `agent-evaluator` convergente.
3. **Antecipar a smoke suite de prompt injection para a Fase 3/4** (mesmo reduzida), cobrindo 100% dos casos adversariais a cada PR que toca `modules/ai`/`modules/documents` — hoje o sistema processaria conteúdo não confiável por ~4 sprints sem essa barreira testada.
4. **Fazer um spike de deploy no GCP ainda em Sprint 1–2** (hello world no Cloud Run) para des-riscar a Fase 6, que hoje concentra Docker prod + CI/CD + deploy + Terraform + Sentry num único sprint sem nenhum deploy anterior no roadmap.
5. **Reservar os primeiros 2–3 dias do Sprint 6 como spike de 1 tool isolada** (`get_customer` ponta a ponta) antes de replicar o padrão para as outras 4 — reduz risco de descobrir problema de arquitetura tarde.
6. **Tratar a nota de corte de escopo das Fases 5 e 7 como escopo-alvo desde o início**, não como plano B.
7. **Considerar um Sprint 15 de buffer/portfolio** — hoje nada no roadmap cobre polimento de UI/UX nem produção de README/demo/vídeo para o portfólio, e não há sprint de contingência para os riscos das Fases 3 e 6.
8. **Ampliar o dataset de evals para 30–50 casos no cenário sem corte** (o PRD propõe 10–20); se cortar, manter um piso de 10 (5 tool selection + 3 retrieval + 2 prompt injection) — nunca sacrificar os casos de segurança.
9. **Decidir chunking antes de escrever o schema definitivo de `DocumentChunk`** — chunking estrutural por cláusula/seção como estratégia primária (300–500 tokens, overlap 15–20%), fallback por tamanho fixo. Mudar depois de ter documentos em produção exige reprocessar tudo.
10. **Adicionar tratamento de PDFs escaneados/tabelas ao escopo da Fase 4** — hoje não mencionado no PRD, mas é o tipo de artefato mais comum em "contrato real" (o próprio caso de uso central do produto).

---

## 6. Riscos únicos que vale destacar (não convergentes, mas relevantes)

- **`rag-pipeline-reviewer`**: "citação da fonte" é hoje um objetivo, não um mecanismo — recomenda grounding set fechado + validação pós-geração que rejeite `chunk_id` alucinado. Sem isso, o critério de aceitação #3 do PRD depende só do comportamento espontâneo do LLM.
- **`security-reviewer`**: SSRF no processamento de PDF não é considerado — parsers de PDF podem resolver recursos externos e, rodando em GCP, alcançar o metadata endpoint interno (`169.254.169.254`).
- **`agent-evaluator`**: dataset de 10-20 casos não serve para medir *taxas* (hallucination rate) com confiança estatística — só serve como suite de regressão determinística; se o objetivo é medir uma taxa, o dataset precisa ser desenhado para forçar os casos, não amostrá-los "naturalmente".
- **`architect`**: módulo `ai` corre risco de virar "god-module" por fan-out conforme mais tools forem adicionadas pós-MVP — tools devem chamar apenas serviços de aplicação públicos dos outros módulos, nunca repositórios internos diretamente.

---

## 7. Decisões — confirmadas em 2026-08-26

Usuário confirmou seguir a recomendação padrão dos agentes nas 5 decisões:

1. ✅ **RLS desde o Sprint 1** nas tabelas mais sensíveis (`Customer`, `Document`, `DocumentChunk`, `AuditLog`), além do Prisma Extension. (Nota de implementação: `Customer`/`Document` só entram no schema na Fase 2 — RLS será ativada quando essas tabelas existirem; o schema da Fase 1, sem dados de cliente ainda, não tem tabela sensível o suficiente para exigir RLS imediata além de `AuditLog`.)
2. ✅ **Corte automático de orçamento de IA já no MVP** (contador Redis por org/mês, comparado a `ai_monthly_budget` antes de cada chamada) — implementar na Fase 3/7, não deixar só como visão no painel.
3. ✅ **Sprint 15 de buffer/portfolio adicionado ao roadmap** (README, demo, polimento de UI, absorção de atraso de F3/F6).
4. ✅ **Dataset de evals-alvo ampliado para 30–50 casos** no cenário sem corte de escopo; piso de 10 (5 tool selection + 3 retrieval + 2 prompt injection) mantido como mínimo sob corte de prazo.
5. ✅ **Blueprint do `code-architect` é a referência oficial de implementação** do Sprint 1 — não reabrir essas decisões durante o código, só via ADR se algo se provar errado na prática.

---

## 8. Próximos passos

1. ✅ Decisões da seção 7 confirmadas.
2. 🚧 Repositório git inicializado e monorepo escrito seguindo o blueprint da seção 4 — "walking skeleton" (Passos 0–2: monorepo, Docker Compose, schema Prisma corrigido, `apps/api` provado até `GET /health`). Módulos de negócio (auth/organizations/memberships/audit — Passos 4–9) ficam para as próximas iterações, um de cada vez, com teste em cada marco.
3. Pendente: transformar a Fase 1 em issues reais no GitHub (o `planner` já entregou 18 issues prontas — seção 3 de `reviews/planner-review.md`).
