# Database Review — OpsMind PRD (modelo de dados, seções 8, 9 e 13)

**Revisor:** database-reviewer (PostgreSQL / schema design / performance / segurança)
**Escopo:** Análise estática do PRD (`docs/planning/PRD.md`) — não há `schema.prisma` no repositório ainda. Esta é uma revisão de design, antes da primeira migration.
**Data:** 2026-08-26

---

## Resumo

O modelo de dados proposto é uma base razoável para um monolito modular multi-tenant, mas tem **duas lacunas críticas de isolamento de tenant** (`DocumentChunk` e `AutomationRun` sem `organization_id`), que contradizem diretamente a regra de negócio da seção 8 ("nenhuma query pode cruzar tenants... reforçado na camada de acesso a dados"). Também faltam campos estruturais para regras que o próprio PRD exige (soft-delete com `deleted_at`, ciclo de vida de convites de 7 dias, limiar de inatividade configurável por organização) e há padrões de "ator polimórfico" (`user|ai|automation`) repetidos sem uma modelagem consistente — a própria `AuditLog` já usa o padrão correto (`actor_type` + `actor_id`) que deveria ser replicado nas demais entidades.

A escolha de pgvector para o MVP é acertada e bem justificada no PRD; o ponto de atenção real não é "se" usar pgvector, mas garantir que a busca vetorial seja filtrada por `organization_id` desde o dia 1 — o que hoje é impossível porque `DocumentChunk` não carrega essa coluna.

Prisma + Postgres é uma combinação sólida, mas o time precisa estar ciente de limitações reais: Prisma não indexa FKs automaticamente no provider Postgres, não tem suporte nativo ao tipo `vector` (exige `Unsupported("vector(n)")` e SQL manual para o índice HNSW), e não modela particionamento nativamente — todos pontos que afetam a estratégia de migrations.

---

## 1. Isolamento multi-tenant

### 1.1 Situação atual, entidade por entidade

| Entidade | `organization_id`? | Avaliação |
|---|---|---|
| Organization | N/A (é o tenant) | OK |
| User | Não tem (correto — identidade global, escopo por `Membership`) | OK |
| Membership | Sim (`user_id`, `organization_id`) | OK, mas falta ciclo de vida de convite (ver 3.4) |
| Customer | Sim | OK |
| Task | Sim | OK |
| Document | Sim | OK |
| **DocumentChunk** | **Não** (só `document_id`) | **CRÍTICO — gap de isolamento** |
| ActivityLog | Sim | OK |
| Automation | Sim | OK |
| **AutomationRun** | **Não** (só `automation_id`) | **CRÍTICO — gap de isolamento** |
| AIRequest | Sim | OK |
| AuditLog | Sim | OK |
| Notification | Sim | OK |

### 1.2 `DocumentChunk` sem `organization_id` — por que isso importa

Este é o achado mais importante da revisão. A busca RAG (seção 13) faz `busca por similaridade no momento da pergunta`, tipicamente:

```sql
SELECT * FROM document_chunk
WHERE organization_id = $1
ORDER BY embedding <=> $2
LIMIT k;
```

Sem `organization_id` na própria tabela, essa query precisa de um `JOIN` com `document` a cada busca vetorial — o que:
- Impede o planner de aplicar o filtro de tenant como prefixo de um índice composto simples;
- Interage mal com índices ANN (HNSW/IVFFlat), que não conseguem usar eficientemente um filtro de igualdade combinado via join — o Postgres normalmente escolhe entre escanear o índice vetorial e pós-filtrar por `organization_id` (risco de recall baixo se o tenant tiver poucos chunks) ou ignorar o índice vetorial. Isso é discutido em detalhe na seção "Viabilidade do pgvector" abaixo.
- Torna impossível implementar RLS diretamente na tabela `document_chunk` sem subquery — RLS baseado em `EXISTS (SELECT 1 FROM document WHERE id = document_chunk.document_id AND organization_id = current_setting(...))` é bem mais caro e mais fácil de configurar errado do que uma comparação direta de coluna.

**Recomendação:** adicionar `organization_id` denormalizado em `DocumentChunk` (preenchido a partir do `Document` pai na criação, imutável depois), com `NOT NULL` e FK. O mesmo vale para `AutomationRun` (denormalizar a partir de `Automation`), pelos mesmos motivos: dashboards de auditoria de automação, RLS e índices de log precisam filtrar por org sem join.

### 1.3 Enforcement: aplicação vs. banco

O PRD é explícito: isolamento "reforçado na camada de acesso a dados, não só na aplicação". Isso sugere duas camadas complementares, não uma só:

1. **Camada de aplicação (obrigatória, dia 1):** um Prisma Client Extension (`$extends`) que injeta automaticamente `where: { organization_id }` em toda query de modelos com escopo de tenant, alimentado por um `organization_id` de request-scope (via `nestjs-cls` ou similar, extraído do JWT). Isso centraliza a regra em um único lugar em vez de depender de cada desenvolvedor lembrar de filtrar manualmente — é a interpretação mínima viável da regra do PRD.
2. **Camada de banco (recomendada como defesa em profundidade, não opcional para um projeto que quer demonstrar rigor de segurança):** Row Level Security (RLS) nativa do Postgres em todas as tabelas com `organization_id`, com policies no padrão `USING (organization_id = current_setting('app.current_org_id')::uuid)`. É o único mecanismo que continua protegendo mesmo se uma query raw, um script administrativo, ou um bug no extension do Prisma esquecer o filtro.

**Ponto de atenção operacional:** RLS baseado em `current_setting` exige `SET LOCAL app.current_org_id = $1` dentro da **mesma transação** da query. Isso é incompatível com PgBouncer em modo *transaction pooling* a menos que o `SET LOCAL` e a query subsequente estejam garantidamente na mesma transação de banco — o que exige que o NestJS abra uma transação Prisma (`$transaction`) por request, não por query solta. Isso tem custo de latência. Recomendação pragmática para o MVP: implementar RLS desde já nas tabelas mais sensíveis (`Customer`, `Document`, `DocumentChunk`, `AuditLog`) e avaliar o overhead antes de estender a todas; manter o Prisma Client Extension como primeira linha de defesa em todas.

### 1.4 Troca de organização na mesma sessão

A regra "sem misturar dados entre elas na mesma sessão" (seção 8) implica que o JWT/sessão carregue um `organization_id` ativo único. Dois pontos não cobertos no modelo:
- Trocar de organização deveria reemitir o token (não só mudar um estado no frontend).
- Se um usuário é removido de uma `Membership`, o JWT antigo (de curta duração, mas ainda válido) não deveria continuar autorizando — o guard de autorização precisa revalidar a `Membership` (não confiar cegamente na claim do JWT) pelo menos em ações sensíveis.

---

## 2. Índices recomendados (dia 1)

Nota geral sobre Prisma: **no provider PostgreSQL, o Prisma não cria índice automaticamente em colunas de chave estrangeira** (ao contrário do MySQL). Todo FK abaixo precisa de `@@index` explícito no `schema.prisma` — isso deve entrar no checklist de code review de toda migration.

| Tabela | Índice | Motivo |
|---|---|---|
| Organization | `UNIQUE(slug)` | Roteamento por slug |
| User | `UNIQUE(lower(email))` (expressão) ou `citext` | Evita duplicidade por caixa alta/baixa |
| Membership | `UNIQUE(user_id, organization_id)`, `INDEX(organization_id)`, `INDEX(user_id)` | Evita membership duplicado; listagem de membros; "minhas orgs" |
| Customer | `INDEX(organization_id, status)` | Filtros de dashboard |
| Customer | `INDEX(organization_id, last_activity_at)` (ideal: `INCLUDE (id, status)`) | Query de "clientes inativos há N dias" — é a query mais citada no PRD (caso de uso 1 e regra de negócio da seção 8) e precisa ser rápida desde o worker de automação |
| Customer | `INDEX(owner_user_id)` | FK |
| Customer | GIN em `tags` se ficar como array nativo (ver 4.3) | Busca por tag |
| Customer | Partial `WHERE deleted_at IS NULL` combinado aos índices acima | Soft delete (ver 4.1) |
| Task | `INDEX(organization_id, status)` | Kanban/board por org |
| Task | `INDEX(organization_id, assignee_id, status)` | "Minhas tarefas" |
| Task | `INDEX(organization_id, due_date)` | Tarefas vencendo |
| Task | `INDEX(customer_id)` | FK, timeline |
| Document | `INDEX(organization_id, status)`, `INDEX(customer_id)` | Listagem/processamento |
| DocumentChunk | `INDEX(document_id)` | FK |
| DocumentChunk | `INDEX(organization_id)` (após adicionar a coluna) | Isolamento e RLS |
| DocumentChunk | `USING hnsw (embedding vector_cosine_ops)` | Busca por similaridade — ver seção "pgvector" abaixo para a discussão de filtro combinado com `organization_id` |
| ActivityLog | `INDEX(organization_id, customer_id, created_at DESC)` | Timeline do cliente |
| ActivityLog | `INDEX(organization_id, created_at DESC)` | Feed de atividade da org |
| Automation | `INDEX(organization_id, enabled)` | Worker varre automações ativas |
| AutomationRun | `INDEX(organization_id, status, created_at DESC)` (após adicionar `organization_id`) | Monitoramento de falhas |
| AutomationRun | `INDEX(automation_id, created_at DESC)` | Histórico de execuções de uma automação |
| AIRequest | `INDEX(organization_id, created_at)` | Dashboard de custo/uso |
| AIRequest | `INDEX(organization_id, user_id, created_at)` | Custo por usuário |
| AuditLog | `INDEX(organization_id, created_at DESC)`, `INDEX(actor_id)` | Consulta de auditoria |
| Notification | `INDEX(organization_id, user_id, read_at)`, partial `WHERE read_at IS NULL` | Badge de não lidas — consulta de alta frequência |

---

## 3. Estratégia de migrations (Prisma)

1. **`prisma migrate dev` local / `prisma migrate deploy` em CI-CD.** Nunca `db push` fora de prototipagem local — `db push` não gera arquivo de migration versionado e não é auditável.
2. **Nunca editar uma migration já aplicada.** O Prisma valida checksum dos arquivos de migration aplicados; editar quebra a validação em qualquer ambiente compartilhado. Mudança = nova migration.
3. **Padrão expand/contract para mudanças destrutivas** (remover coluna, tornar coluna `NOT NULL`, renomear): adicionar coluna nova nullable → backfill → deploy do código que passa a usar a coluna nova → migration que aplica `NOT NULL`/remove a coluna antiga em um passo seguinte. Isso evita quebrar instâncias da API em rolling deploy que ainda esperam o schema antigo.
4. **pgvector exige SQL manual.** O tipo `vector(n)` só é representável no `schema.prisma` como `Unsupported("vector(1536)")` (ajustar dimensão ao modelo de embedding escolhido), e o índice HNSW (`CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`) não é gerado pelo Prisma — precisa ser adicionado manualmente na migration SQL gerada. O mesmo vale para `CREATE EXTENSION IF NOT EXISTS vector;`. Documentar esse fluxo (gerar migration vazia com `prisma migrate dev --create-only`, editar o SQL à mão, depois aplicar) para não ser redescoberto sob pressão depois.
5. **Particionamento não é nativo no Prisma.** `AuditLog` (e possivelmente `ActivityLog`/`AIRequest` no futuro) são logs append-only sem fim natural de crescimento; se decidir particionar por `created_at` (recomendado, ver seção 4), a partição precisa ser criada via SQL manual dentro de uma migration Prisma, e a **chave primária de uma tabela particionada por `created_at` precisa incluir `created_at`** (`PRIMARY KEY (id, created_at)`), uma decisão que é dolorosa de mudar depois. Recomendo decidir isso *antes* da primeira migration dessas tabelas, mesmo que o particionamento físico só seja ativado mais tarde — mudar a PK depois de haver dados em produção é uma migration de alto risco.
6. **CI valida drift.** Rodar `prisma migrate diff` (schema vs. shadow DB) como step de CI antes de `migrate deploy`, para pegar migrations divergentes ou aplicadas fora de ordem.
7. **Prisma não tem down-migrations nativas.** Para mudanças de schema de risco alto em produção, manter um script SQL de rollback documentado ao lado da migration (não gerenciado pelo Prisma, mas versionado no repo) para os casos em que reverter for necessário sob incidente.
8. **snake_case no banco via `@map`/`@@map`.** Modelos/campos em camelCase no Prisma (convenção TS), mapeados para `snake_case` nas colunas — consistente com convenção Postgres e evita identificadores com aspas.
9. **IDs: evitar UUID v4 puro como PK.** UUID aleatório causa fragmentação de índice B-tree (inserções espalhadas pela árvore, page splits, pior localidade de cache) em tabelas de alto volume de escrita como `DocumentChunk`, `AIRequest`, `ActivityLog`, `AuditLog`. Preferir UUIDv7 (ordenável por tempo, mantém as vantagens de ID não-sequencial/não-enumerável para uso público, mas com localidade de inserção como um `bigint` sequencial) ou `bigint IDENTITY` combinado com um `public_id` UUID separado para exposição externa, se enumerabilidade de `bigint` for uma preocupação de segurança em rotas públicas.

---

## 4. Riscos de performance/escala e entidades mal modeladas

### 4.1 Falta `deleted_at` no modelo (contradiz a própria regra de negócio)

A seção 8 exige soft-delete com trilha de auditoria para cliente e documento, mas o esboço de `Customer` e `Document` na seção 9 não tem `deleted_at`. Isso precisa ser um campo explícito (`deleted_at timestamptz NULL`), com índices parciais `WHERE deleted_at IS NULL` nas consultas de listagem (padrão já citado no princípio-chave do próprio processo de revisão). Sem isso, "soft-delete" vira um campo de status ad-hoc sem um jeito padronizado de filtrar registros ativos, e toda query em `Customer`/`Document` precisa lembrar de excluir os deletados manualmente — risco real de vazamento de dado "apagado" em listagens.

### 4.2 Padrão de "ator polimórfico" inconsistente

`ActivityLog.actor (user|ai|system)`, `Task.created_by (user|ai|automation)` e `AutomationRun.triggered_by` são modelados como campo único sem uma FK íntegra — não dá para fazer `JOIN` seguro para saber *qual* usuário ou *qual* automação foi o ator. `AuditLog` já resolve isso corretamente com `actor_type` + `actor_id` separados. Recomendo replicar esse padrão (`actor_type` enum + `actor_id` nullable, sem FK rígida cruzando tipos, ou FKs opcionais paralelas: `actor_user_id`, `actor_automation_id`) nas demais entidades, para permitir relatórios como "quantas tarefas a IA criou" sem parsing de texto.

### 4.3 `Customer.tags[]` como array nativo

Como array de texto direto na tabela, sem escopo de organização própria: risco de duplicidade por digitação (`"Cliente VIP"` vs `"vip"`), impossível renomear uma tag em todos os clientes de uma vez, sem vocabulário controlado por org. Recomendo normalizar em `Tag(id, organization_id, name)` + tabela de junção `CustomerTag(customer_id, tag_id)`, com `UNIQUE(organization_id, name)`. Se optarem por manter o array por simplicidade no MVP, no mínimo adicionar índice GIN (`USING gin (tags)`) para buscas por `tags @> ARRAY[...]`.

### 4.4 `DocumentChunk` sem versão/modelo de embedding

Além da falta de `organization_id` (crítico, seção 1.2), falta um campo para identificar **qual modelo de embedding** gerou cada vetor (`embedding_model`, ex.: `text-embedding-3-small`). Sem isso, uma troca futura de modelo de embedding (upgrade de qualidade, troca de provider) deixa vetores de dimensões/espaços diferentes misturados na mesma coluna, produzindo resultados de similaridade incorretos sem erro visível. Recomendo adicionar `embedding_model text NOT NULL` desde o dia 1, mesmo com um único valor possível hoje — é caro adicionar depois que já existem milhões de chunks sem essa informação.

### 4.5 `AIRequest` como fonte única do orçamento de IA

A seção 8 exige checagem de orçamento mensal por organização, e essa tabela cresce a cada chamada de IA (potencialmente o maior volume de escrita do sistema). Calcular "quanto a org já gastou este mês" agregando `SUM(estimated_cost)` sobre `AIRequest` bruta a cada request de IA (para decidir se corta o acesso) não escala — vira um `SUM` sobre uma tabela cada vez maior, no caminho crítico de latência de cada chamada de IA. Recomendo:
- Um contador incremental (Redis, que o stack já usa via BullMQ) por `organization_id` + mês, atualizado atomicamente a cada `AIRequest` gravado, usado para a checagem rápida de orçamento;
- `AIRequest` continua como fonte de verdade granular (auditoria, analytics detalhado), com uma reconciliação periódica entre o contador e o `SUM` real para evitar drift.

### 4.6 `AuditLog`/`ActivityLog` como logs não particionados

São, por natureza, append-only e de retenção potencialmente indefinida (compliance). Sem particionamento, uma tabela de auditoria de um projeto que roda por anos cresce sem limite, degradando índice e vacuum. Não é urgente implementar particionamento física no MVP (baixo volume, projeto de portfólio), mas a **decisão de chave primária composta (`id, created_at`) precisa ser tomada agora** se a intenção é particionar por `created_at` mais tarde (ver seção 3, item 5) — mudar isso depois de haver dados é caro.

### 4.7 Campos JSON de automação (`trigger`, `conditions`, `actions`)

Adequado para o MVP, dado o escopo reduzido explicitado na seção 17 ("reduz Automations a 1-2 regras fixas"). Mas é uma DSL sem schema/versionamento — se o roadmap pós-MVP (builder visual) avançar, essas colunas JSONB vão precisar de um campo de versão do formato (`schema_version`) desde já, para permitir migração de automações antigas quando o formato do DSL mudar, sem quebrar automações já salvas.

### 4.8 Falta modelagem de convite (`Invitation`)

A seção 8 define uma regra de negócio explícita (convites expiram em 7 dias), mas não há nenhuma entidade ou campo no modelo de dados da seção 9 capaz de representar um convite pendente — `Membership` pressupõe um `user_id` existente, mas um convite por e-mail acontece **antes** de a pessoa convidada ter conta. Recomendo uma entidade `Invitation(id, organization_id, email, role, token, invited_by, expires_at, accepted_at)` separada de `Membership`, promovida a `Membership` só na aceitação.

### 4.9 Falta de configuração por organização

O limiar de inatividade ("configurável por organização, padrão 14 dias", seção 8) não tem onde morar no modelo — `Organization` não tem um campo de configuração. Recomendo `inactive_after_days int NOT NULL DEFAULT 14` (ou um `settings jsonb` genérico se antecipam mais configurações por org no futuro, com os campos realmente consultados/filtrados mantidos como colunas de primeira classe, não dentro do JSON).

### 4.10 Tipos de dado a confirmar na modelagem física

- `estimated_cost` (AIRequest) e `ai_monthly_budget` (Organization): usar `numeric`, nunca `float`/`double precision` — custo de IA em frações de centavo não pode acumular erro de ponto flutuante.
- Todo timestamp: `timestamptz`, nunca `timestamp` sem timezone.
- `tool_calls[]` em `AIRequest`: provavelmente registros estruturados (nome da tool, args, resultado) — se for esse o caso, deveria ser `jsonb` (array de objetos), não um array escalar de texto.

---

## 5. Viabilidade do pgvector no MVP vs. vector DB dedicado

**A escolha de pgvector para o MVP está correta** e bem justificada no PRD (evita infraestrutura extra, mantém consistência transacional com os dados de CRM que a IA também consulta, barato de operar para um projeto solo). Na escala implícita pelo MVP (dezenas de organizações, poucos milhares de documentos, dezenas de milhares de chunks), HNSW no pgvector entrega latência sub-100ms com parâmetros (`m`, `ef_construction`, `ef_search`) razoáveis.

Recomendações específicas:
- Preferir **HNSW** a IVFFlat (pgvector ≥ 0.5.0): não exige retreinar `lists` conforme os dados crescem, e tem melhor trade-off recall/latência para cargas de escrita incremental como upload contínuo de documentos.
- **O ponto real de atenção não é pgvector em si, é o filtro por `organization_id` combinado com a busca vetorial** (ver seção 1.2). Índices ANN não compõem trivialmente com um filtro de igualdade via `JOIN`. Depois de adicionar `organization_id` diretamente em `DocumentChunk`, validar com `EXPLAIN ANALYZE` se o Postgres está de fato usando o índice HNSW com o filtro, ou fazendo post-filter (o que pode reduzir recall quando uma organização tem poucos chunks relativos a `k`). Se o recall cair, aumentar `hnsw.ef_search` é o primeiro ajuste antes de considerar qualquer mudança estrutural.
- Definir e documentar (ex.: como ADR) os **gatilhos objetivos de migração** para um vector DB dedicado, em vez de decidir isso de forma reativa:
  1. Latência p95 de busca RAG acima da meta (ex.: >500ms–1s) mesmo após tuning de índice;
  2. `DocumentChunk` passando de ~5–10 milhões de linhas com degradação perceptível;
  3. Necessidade de recursos que pgvector não cobre bem (busca híbrida em escala, re-indexação em tempo real sob altíssimo throughput de escrita, DSL de filtro mais rico);
  4. Contenção de recursos entre a carga transacional do CRM e a carga de busca vetorial na mesma instância Postgres, a ponto de precisar escalar cada uma independentemente.
  Nenhum desses gatilhos se aplica na escala do MVP — migrar cedo para um vector DB dedicado adicionaria complexidade operacional sem benefício real neste estágio, exatamente como o PRD já argumenta para não usar microsserviços prematuramente.

---

## 6. Recomendações priorizadas

### Crítico (bloqueante antes da primeira migration em produção)
1. Adicionar `organization_id` a `DocumentChunk` e `AutomationRun` (denormalizado, `NOT NULL`, FK) — sem isso, a regra de isolamento multi-tenant do PRD (seção 8) não é satisfazível nessas duas tabelas.
2. Definir a estratégia de enforcement de tenant em duas camadas: Prisma Client Extension (app layer, obrigatório) + RLS no Postgres (defesa em profundidade) para as tabelas mais sensíveis (`Customer`, `Document`, `DocumentChunk`, `AuditLog`).
3. Adicionar `deleted_at timestamptz` em `Customer` e `Document` para viabilizar o soft-delete exigido pela seção 8, com índices parciais `WHERE deleted_at IS NULL`.
4. Modelar `Invitation` como entidade própria — hoje não há onde representar um convite pendente antes de existir `User`, apesar da regra de expiração de 7 dias já definida no PRD.

### Alto
5. Adicionar `embedding_model` em `DocumentChunk` antes de gravar o primeiro vetor — caríssimo de reconstruir depois em escala.
6. Criar os índices compostos listados na seção 2, com destaque para `(organization_id, last_activity_at)` em `Customer` (query de inatividade, citada como caso de uso central) e `(organization_id, read_at)` parcial em `Notification`.
7. Substituir o padrão de ator livre (`actor`, `created_by`, `triggered_by`) por `actor_type` + `actor_id`, replicando o padrão já correto de `AuditLog`.
8. Decidir agora a estratégia de PK para `AuditLog`/`ActivityLog`/`AIRequest` (se `(id, created_at)` composta, para viabilizar particionamento futuro sem migration dolorosa) — mesmo sem particionar fisicamente ainda.
9. Trocar contador de orçamento de IA de "agregação sobre `AIRequest`" para contador incremental (Redis) com reconciliação periódica, para não colocar um `SUM` no caminho crítico de cada chamada de IA.

### Médio
10. Normalizar `Customer.tags[]` em `Tag`/`CustomerTag` (ou, no mínimo, índice GIN se mantido como array).
11. Adicionar `inactive_after_days` (ou `settings jsonb`) em `Organization` para tornar o limiar de inatividade de fato configurável, como a regra de negócio exige.
12. Confirmar tipos de dado: `numeric` para custo/orçamento (nunca float), `timestamptz` em todos os timestamps, `jsonb` (não array escalar) para `tool_calls`.
13. Preferir UUIDv7 (ou `bigint IDENTITY` + `public_id` separado) a UUID v4 aleatório como PK em tabelas de alto volume de escrita (`DocumentChunk`, `AIRequest`, `ActivityLog`, `AuditLog`).

### Baixo / observação para roadmap
14. Adicionar `schema_version` nos campos JSON de `Automation` (`trigger`/`conditions`/`actions`) antes de evoluir para o builder visual pós-MVP.
15. Documentar como ADR os gatilhos objetivos de migração de pgvector para vector DB dedicado (seção 5), para que a decisão seja proativa.
16. Validar com `EXPLAIN ANALYZE` o comportamento real do índice HNSW combinado com filtro `organization_id` assim que houver dados de teste — ajustar `hnsw.ef_search` conforme necessário.
