# Review Crítico — Roadmap OpsMind (Seção 17 do PRD)

**Autor:** planner (subagente)
**Escopo:** Revisão de planejamento apenas — nenhum arquivo de código foi criado, editado ou modificado.
**Fonte analisada:** `/Users/pam/Documents/Opsmind/docs/planning/PRD.md`, seção 17 ("Roadmap por Sprints"), com leitura cruzada das seções 5–16 para validar dependências técnicas.
**Contexto do projeto:** greenfield — apenas o PRD existe no repositório até o momento desta revisão; não há código para avaliar arquitetura existente.

---

## 1. Resumo

O roadmap de 14 sprints (≈7 meses a 15–25h/semana) é **plausível na soma total**, mas **desequilibrado entre fases**: fases de CRUD (Fase 2) provavelmente têm folga, enquanto a Fase 3 (AI Assistant/Tool Calling) e a Fase 6 (Production Readiness) concentram o maior risco de estouro por envolverem trabalho de natureza exploratória (debugging de tool calling, infra em nuvem pela primeira vez) que é sistematicamente subestimado em planejamentos lineares. Há também uma inconsistência real de dependências: a arquitetura de filas (BullMQ/Redis, seção 12) é usada implicitamente já na Fase 3/4, mas só aparece explicitamente descrita na Fase 5; e a infraestrutura de storage (GCS) é necessária na Fase 4, mas o Terraform/IaC que a formaliza só chega na Fase 6. O roadmap também não reserva tempo para CI cedo (só chega no Sprint 13), para teste de prompt injection logo após o RAG entrar em produção (só no Sprint 14, mesmo documentos maliciosos entrando em jogo desde o Sprint 9), nem para polimento de UI/UX ou para produção do material de portfólio (README, demo, vídeo) — nenhum desses itens tem hora alocada em lugar nenhum do roadmap atual.

A Fase 1 (Sprints 1–2) foi decomposta em 18 issues concretas com critério de pronto, somando uma estimativa de ~80–90h de trabalho de engenharia — dentro da faixa de 60–100h implícita no roadmap (2 sprints × 30–50h/semana), mas próxima do teto, o que reforça a recomendação de manter escopo enxuto nessa fase e não adicionar nada além do que já está descrito no PRD.

---

## 2. Avaliação do roadmap

### 2.1 Estimativas para ritmo part-time (15–25h/semana)

Fazendo a conta com sprints de 2 semanas (30–50h de capacidade por sprint):

| Fase | Sprints | Capacidade estimada | Escopo | Avaliação |
|---|---|---|---|---|
| F1 — Foundation | 2 | 60–100h | Monorepo, Docker, Prisma, Auth, Org/RBAC, Audit | Apertado mas viável (ver quebra na seção 4: ~80–90h estimadas) |
| F2 — Core Product | 3 | 90–150h | CRUD Customers/Tasks, timeline, dashboard, notificações | Provavelmente tem folga — é o trabalho mais mecânico/previsível do roadmap |
| F3 — AI Assistant | 3 | 90–150h | AI Gateway, chat com contexto, 5 tools, logging | **Maior risco de estouro** — tool calling e streaming são iterativos por natureza, difícil estimar bem na primeira vez |
| F4 — Documents + RAG | 2 | 60–100h | Upload, extração, chunking, embeddings, busca semântica | Razoável, mas extração de PDF real (multi-coluna, tabelas) costuma comer mais tempo do que parece |
| F5 — Automations | 2 | 60–100h | Motor trigger→condição→ação, worker, automação padrão | Razoável **se** o escopo for mantido mínimo (risco de over-engineering do motor de regras) |
| F6 — Production Readiness | 1 | 30–50h | Docker prod, CI/CD, GCP deploy, Terraform, rate limiting, Sentry | **Segundo maior risco de estouro** — primeiro deploy em nuvem costuma ter fricção imprevisível (IAM, DNS, segredos) e aqui está espremido em 1 sprint só, sem buffer depois |
| F7 — AI Engineering Polish | 1 | 30–50h | Painel de custo, budget, eval suite, teste de prompt injection | Ambicioso para 1 sprint, mas já tem cláusula de corte de escopo explícita no próprio PRD, o que mitiga o risco |

**Conclusão:** a soma total (≈420–700h, compatível com os ~560h implícitos em 14 sprints × 20h/semana médio) é razoável como estimativa agregada. O problema não é o total, é a distribuição — F2 tem mais tempo do que precisa, enquanto F3 e F6 têm menos do que historicamente esse tipo de trabalho consome. Recomendo remanejar folga de F2 para F3/F6 em vez de manter blocos rígidos de 2/3 sprints por fase.

### 2.2 Ordem de dependências entre fases

A sequência macro (F1 → F2 → F3 → F4 → F5) está **correta** nos pontos essenciais:

- **F3 depende de F1**: as tools de IA precisam de RBAC e isolamento por tenant já funcionando (seção 10.3 — toda tool passa pelo mesmo `AuthorizationGuard`) e de Audit Log para registrar ações da IA (seção 8, regra 3 e seção 14). Corretamente sequenciado depois de F1. ✅
- **F3 depende de F2**: as 5 tools iniciais (`get_customer`, `search_customers`, `create_task`, `get_customer_activity`, `list_tasks`) operam sobre dados de Customer/Task/ActivityLog que só existem depois de F2. Corretamente sequenciado depois de F2. ✅
- **F4 depende de F3**: a citação de fonte na resposta da IA (seção 4, caso 4) pressupõe o chat/AI Gateway já funcionando. Corretamente sequenciado depois de F3. ✅

Porém há **duas lacunas de dependência não explicitadas** que valem a pena corrigir na descrição do roadmap:

1. **Fila (BullMQ/Redis) é usada antes de ser "oficialmente" introduzida.** A seção 12 do PRD já modela `document-processing` como fila (usada na F4) e `ai-tool-execution` como fila (usada na F3, se a execução de tools for assíncrona). Mas a descrição textual da Fase 5 é a primeira a mencionar BullMQ explicitamente. Ou a infraestrutura de fila é fundação (deveria estar em F1, mesmo que vazia/boilerplate) e cada fase subsequente só adiciona processors, ou a execução de tools em F3 é síncrona (sem fila) e a fila só entra de fato em F4 — o PRD não deixa isso explícito, e isso é uma ambiguidade de planejamento que deveria ser resolvida antes do Sprint 6, não descoberta durante ele.
2. **Storage (GCS) é necessário em F4, mas o Terraform que o formaliza só vem em F6.** Isso significa que, na prática, o bucket do GCS e as credenciais de upload precisarão ser provisionados manualmente (console/CLI) durante a F4, e só depois "capturados" em Terraform na F6 — o que é aceitável, mas deveria estar explícito no roadmap como uma decisão consciente ("F4 usa GCS provisionado manualmente; F6 formaliza em IaC"), não como uma lacuna implícita.

### 2.3 Riscos de estouro de prazo por fase

Do maior para o menor risco:

1. **Fase 6 — Production Readiness (Sprint 13).** Concentra Docker de produção + CI/CD + deploy GCP + Terraform + rate limiting + Sentry + logging estruturado em **um único sprint de 2 semanas**, sendo (presumivelmente) o primeiro deploy real do projeto. Deploy em nuvem pela primeira vez costuma gerar fricção não linear (permissões IAM, DNS/SSL, variáveis de ambiente erradas em produção, diferenças dev/prod) que não aparece nas fases anteriores, todas rodando local via Docker Compose. Não há sprint de buffer depois — se F6 atrasar, o atraso vaza direto para F7, que é a fase que sustenta a demo de portfólio.
   - **Mitigação sugerida:** fazer um "spike" de deploy bem cedo (ex.: durante F1 ou F2, subir um "hello world" da API no GCP) só para mapear fricção de infra com antecedência, quando ainda há folga no cronograma para absorver surpresas. Também vale considerar cortar Terraform "completo" do escopo do MVP (usar Console/CLI + documentação manual) e tratar IaC como melhoria pós-v1, já que o critério de aceitação da F6 (seção 17) pede "deploy reproduzível", que não exige necessariamente Terraform.

2. **Fase 3 — AI Assistant + Tool Calling (Sprints 6–8).** É a fase de maior risco técnico "puro": streaming, seleção de tools, tratamento de erros de tool calling (JSON malformado, tool certa com parâmetro errado, timeout do provider) são areas onde a curva de aprendizado e o ciclo de tentativa-e-erro dominam o tempo gasto, mais do que em CRUD ou infra. Historicamente esse tipo de trabalho é subestimado por quem não construiu um agente com tool calling antes.
   - **Mitigação sugerida:** reservar os primeiros 2–3 dias do Sprint 6 como um spike isolado — implementar 1 tool única (`get_customer`) ponta a ponta, sem as outras 4, para validar o padrão (AI Gateway, guard de autorização, logging) antes de replicar para as demais. Isso reduz o risco de descobrir um problema de arquitetura na tool #4 depois de já ter investido no padrão errado.

3. **Fase 5 — Automations (Sprints 11–12).** Risco moderado, mas de natureza diferente: é tentador construir um motor de regras genérico e flexível (builder de condições, múltiplos triggers configuráveis) quando o PRD pede, na prática, pouco mais que "cliente inativo → cria tarefa + notifica". A própria nota de corte de escopo do PRD (final da seção 17) já reconhece isso ("reduz Automations a 1-2 regras fixas, sem builder").
   - **Mitigação sugerida:** tratar a nota de corte de escopo não como plano B emergencial, mas como escopo-alvo desde o início da F5 — implementar as 1-2 regras fixas primeiro, e só generalizar o motor se sobrar tempo.

4. **Fase 4 — Documents + RAG (Sprints 9–10).** Risco moderado: extração de texto de PDFs reais (multi-coluna, tabelas, PDFs escaneados sem OCR) é mais confiável em teoria do que na prática. O PRD corretamente não inclui OCR no MVP, o que já reduz bastante o risco, mas vale reservar tempo para testar com PDFs "sujos" reais (contratos digitalizados, não só PDFs nativos limpos), não só com exemplos ideais.

5. **Fase 1 — Foundation (Sprints 1–2).** Risco moderado-baixo, mas não trivial: é a primeira vez que o stack inteiro (Turborepo/Nx + NestJS + Prisma + Next.js + JWT refresh flow) é montado junto. Ver quebra detalhada na seção 4 — a soma das estimativas (~80–90h) já está perto do teto da capacidade de 2 sprints (100h), então qualquer fricção de tooling (ex.: configuração de monorepo, versões incompatíveis) pode empurrar para o Sprint 3.

6. **Fase 2 — Core Product (Sprints 3–5) e Fase 7 — AI Engineering Polish (Sprint 14).** Risco relativamente baixo. F2 é trabalho mecânico bem compreendido (CRUD). F7 é ambiciosa para 1 sprint, mas já tem cláusula de corte de escopo explícita (reduzir eval suite a 10 casos) que funciona como válvula de escape.

### 2.4 Passos intermediários faltando no roadmap

1. **CI só aparece no Sprint 13.** Rodar lint/typecheck/testes automaticamente a cada PR deveria começar na Fase 1 (mesmo que mínimo), não na penúltima fase. Sem isso, 12 sprints de desenvolvimento acontecem sem rede de segurança automatizada contra regressão — o risco de dívida técnica silenciosa acumulada é alto. **Recomendação:** mover um CI mínimo (lint + typecheck + testes) para a Fase 1 (já incluído na quebra da seção 4, issue F1-07); deixar para o Sprint 13 apenas o pipeline de deploy/CD propriamente dito.

2. **Teste de prompt injection só no Sprint 14, mas documentos entram no sistema no Sprint 9–10.** A seção 4 (caso de uso 7) e a seção 14 tratam a proteção contra prompt injection como diferencial central do produto, mas o teste automatizado só é planejado para a última fase — ou seja, o sistema processa conteúdo não confiável de documentos por 4+ sprints (F4 até F6) antes dessa barreira ser verificada. **Recomendação:** incluir pelo menos um teste manual/smoke de prompt injection logo ao final da F4 (quando RAG entra em produção), mantendo a suíte automatizada completa para F7.

3. **Rate limiting em endpoints de auth está agendado só para F6 ("Production Readiness"), mas é uma preocupação de segurança básica desde o dia 1.** Proteção contra força bruta em login/registro não deveria esperar até o sprint de deploy — já está incluída na quebra da F1 abaixo (issue F1-10) como recomendação desta revisão, mesmo não estando explícita no texto original do PRD para a Fase 1.

4. **Nenhuma fase reserva tempo para polimento de UI/UX.** "Fase 7 — AI Engineering Polish" trata de custo/eval de IA, não de interface. Para um projeto que existe também como peça de portfólio, isso é uma lacuna real: não há sprint dedicado a revisão visual, responsividade, estados vazios/loading/erro na UI, etc. Isso provavelmente é absorvido "de graça" dentro de cada fase, mas vale nomear explicitamente para não ser esquecido sob pressão de prazo.

5. **Nenhuma fase reserva tempo para README, gravação de demo e material de portfólio.** Para o objetivo declarado do projeto (seção 1 — peça de portfólio), a apresentação final (README bem escrito, vídeo/GIF de demo, screenshots, texto de portfólio) é trabalho real e não trivial que hoje não tem hora alocada em lugar nenhum do roadmap.

6. **Ausência de sprint de buffer/contingência.** 14 sprints encadeados sem folga é frágil para um projeto part-time solo, onde imprevistos pessoais (viagem, doença, semanas de menos disponibilidade) são a norma, não a exceção. **Recomendação:** adicionar um "Sprint 15 — Buffer & Portfolio" reservado explicitamente para absorver atrasos das fases de maior risco (F3 e F6) e para os itens 4 e 5 acima, em vez de torcer para que tudo caiba exatamente em 14 sprints.

7. **Seed data / dados de demonstração não mencionados.** Para desenvolvimento incremental (testar RBAC, timeline, dashboard) e para a demo final, é necessário um script de seed com dados realistas. Incluído na quebra da F1 abaixo (issue F1-17), mas vale reforçar que sem isso cada fase subsequente perde tempo recriando dados de teste manualmente.

---

## 3. Quebra detalhada da Fase 1 (Sprints 1–2 — Foundation) em issues

Escopo da Fase 1 conforme PRD: *"Monorepo, Docker Compose local, Prisma + schema inicial, Auth (registro/login/refresh), Organizations + Membership + RBAC básico, Audit log mínimo."*
Critério de aceitação da fase (PRD): *"um usuário consegue criar uma organização, convidar outro usuário com um papel específico, e uma ação sensível gera um registro de auditoria."*

Abaixo, 18 issues com ordem de execução sugerida. As issues F1-07 e F1-10 são adições desta revisão (não estão explícitas no texto do PRD) porque cobrem lacunas identificadas na seção 2.4; todas as demais mapeiam diretamente o escopo descrito no PRD. Estimativa total: ~80–90h (dentro da faixa de 60–100h de capacidade de 2 sprints).

### Bloco A — Infraestrutura base (fazer primeiro; tudo depende disso)

**F1-01. Setup do monorepo (Turborepo ou Nx)**
Descrição: Criar a estrutura `apps/web`, `apps/api`, `packages/database`, `packages/shared-types`, `packages/config` conforme seção 16 do PRD, com scripts raiz (`dev`, `build`, `lint`, `test`) orquestrados pela ferramenta de monorepo escolhida.
Critério de pronto: `pnpm install` na raiz instala tudo; `pnpm dev` sobe web e api (mesmo vazios) sem erro; lint e tsconfig são compartilhados via `packages/config` nos dois apps.

**F1-02. Docker Compose local (Postgres + pgvector, Redis)**
Descrição: `docker-compose.yml` com Postgres (imagem com extensão pgvector habilitada) e Redis, com healthchecks e volumes persistentes.
Critério de pronto: `docker compose up` sobe os dois serviços saudáveis; `CREATE EXTENSION vector;` executa sem erro no Postgres subido; dados sobrevivem a um restart do container.
Depende de: nenhuma (paralelo a F1-01).

**F1-03. Schema de variáveis de ambiente**
Descrição: `.env.example` documentando todas as variáveis necessárias (DB, Redis, JWT secrets, etc.) e validação de env na subida da app (Zod) em `packages/config`.
Critério de pronto: subir a API sem uma variável obrigatória falha com mensagem clara nomeando a variável faltante; `.env.example` está atualizado e comitado.
Depende de: F1-01.

### Bloco B — Esqueletos de aplicação

**F1-04. Prisma init + schema inicial (subset da Fase 1)**
Descrição: Inicializar Prisma em `packages/database` com as entidades necessárias para autenticação/RBAC/auditoria: `Organization`, `User`, `Membership`, `AuditLog` (as demais entidades do modelo completo — Customer, Task, Document etc. — ficam para as fases 2–4, quando forem de fato usadas).
Critério de pronto: `prisma migrate dev` roda limpo contra o Postgres do F1-02 e gera o client; schema versionado e comitado em `packages/database`.
Depende de: F1-01, F1-02.

**F1-05. Setup NestJS base**
Descrição: Módulos vazios (`auth`, `organizations`, `users`, `audit`), estrutura `shared/guards`, `shared/decorators`, `shared/pipes` (conforme seção 10.2), filtro global de exceções, `ValidationPipe` configurado.
Critério de pronto: `GET /health` responde 200; estrutura de pastas `modules/`, `infrastructure/`, `shared/` criada e importável entre módulos.
Depende de: F1-01, F1-03.

**F1-06. Setup Next.js base**
Descrição: App Router, Tailwind, shadcn/ui, React Query configurados; tela de login/placeholder inicial.
Critério de pronto: app sobe em modo dev sem erro de lint/type; navegação básica entre uma rota pública (login) e uma protegida (placeholder) funciona.
Depende de: F1-01.

**F1-07. CI mínimo (GitHub Actions)** *(adição desta revisão — ver seção 2.4, item 1)*
Descrição: Workflow que roda lint + typecheck + testes em cada PR/push, para os dois apps.
Critério de pronto: um PR de teste com um erro de lint proposital falha o workflow; um PR limpo passa.
Depende de: F1-01, F1-05, F1-06.

### Bloco C — Autenticação

**F1-08. Registro de usuário + verificação de e-mail**
Descrição: `POST /auth/register` cria usuário com senha hasheada (argon2/bcrypt) e dispara fluxo de verificação de e-mail (em dev, pode ser log local em vez de envio real).
Critério de pronto: usuário criado com senha nunca armazenada em texto puro; token/link de verificação gerado; teste automatizado cobre "e-mail duplicado é rejeitado".
Depende de: F1-04, F1-05.

**F1-09. Login + JWT de curta duração + refresh token**
Descrição: `POST /auth/login` retorna par access+refresh token; `POST /auth/refresh` emite novo par e invalida (rotaciona) o refresh token anterior.
Critério de pronto: login com credenciais corretas retorna tokens válidos; token expirado é rejeitado em rota protegida; reuso de um refresh token já rotacionado é rejeitado (proteção contra replay).
Depende de: F1-08.

**F1-10. Rate limiting nos endpoints de auth** *(adição desta revisão — ver seção 2.4, item 3)*
Descrição: Limite de tentativas em `/auth/login`, `/auth/register`, `/auth/refresh` por IP/usuário.
Critério de pronto: teste automatizado prova que a N+1-ésima tentativa de login falha dentro da janela configurada retorna 429, não 401.
Depende de: F1-09.

### Bloco D — Organizações, RBAC e isolamento de tenant

**F1-11. Criação de organização**
Descrição: `POST /organizations` cria a organização e vincula automaticamente o criador como `Membership` com `role=owner`.
Critério de pronto: organização criada tem exatamente um owner (o criador); usuário sem nenhuma `Membership` não consegue acessar rotas que exigem organização ativa.
Depende de: F1-09.

**F1-12. Convite de membros + aceite (expiração 7 dias)**
Descrição: `POST /organizations/:id/invite` gera convite com papel definido e token com expiração de 7 dias (regra de negócio, seção 8); endpoint de aceite cria a `Membership` correspondente.
Critério de pronto: convite aceito dentro do prazo cria `Membership` com o papel correto; convite expirado é rejeitado com erro claro; teste automatizado cobre ambos os casos.
Depende de: F1-11.

**F1-13. Guard de RBAC central (5 papéis)**
Descrição: Guard/decorator reutilizável (`@RequireRole(...)`) aplicando a hierarquia Owner > Admin > Manager > Member > Viewer (seção 14) em qualquer rota.
Critério de pronto: rota decorada retorna 403 para papel insuficiente e 200 para papel suficiente, coberto por teste automatizado parametrizado pelos 5 papéis.
Depende de: F1-11.

**F1-14. Guard de isolamento por tenant**
Descrição: Middleware/guard que resolve `organization_id` a partir do contexto de sessão (não do body/URL fornecido pelo cliente) e bloqueia qualquer tentativa de acessar recurso de outra organização.
Critério de pronto: teste automatizado prova que um usuário da organização A recebe 403/404 (não vazamento de dado) ao tentar forçar acesso a um recurso pertencente à organização B, mesmo manipulando o payload da requisição.
Depende de: F1-11, F1-13.

**F1-15. Troca de contexto de organização (multi-org)**
Descrição: Endpoint/mecanismo de sessão para um usuário com múltiplas `Membership`s selecionar a organização ativa (regra de negócio, seção 8 — sem misturar dados entre organizações na mesma sessão).
Critério de pronto: usuário com 2 memberships consegue trocar a organização ativa; chamadas subsequentes na mesma sessão só retornam dados da organização selecionada.
Depende de: F1-14.

### Bloco E — Auditoria e finalização

**F1-16. Audit log mínimo**
Descrição: Tabela `AuditLog` + serviço central + interceptor/decorator que registra automaticamente ações sensíveis: login, criação de organização, convite aceito, mudança de papel.
Critério de pronto: cada uma dessas ações gera uma linha em `AuditLog` com `actor`, `action`, `resource` e `created_at`; consultável via `GET /audit-logs` restrito a Owner/Admin (via F1-13).
Depende de: F1-09, F1-11, F1-12, F1-13.

**F1-17. Seed script de dados de desenvolvimento**
Descrição: Script (`pnpm seed`) que popula o ambiente local com uma organização de demonstração, usuários cobrindo os 5 papéis, e alguns registros de audit log.
Critério de pronto: rodar o script do zero deixa o ambiente pronto para testar manualmente RBAC e fluxo de convite sem recriar dados na mão; reexecutável (idempotente ou com reset limpo).
Depende de: F1-16.

**F1-18. Testes automatizados consolidados da Fase 1**
Descrição: Não é uma issue "no final" — é o lembrete de que cada issue acima (especialmente F1-09, F1-10, F1-13, F1-14, F1-16) já deve incluir seus próprios testes automatizados como parte do "critério de pronto" individual. Esta issue cobre apenas os testes de integração ponta a ponta que amarram várias peças juntas (ex.: registrar → logar → criar org → convidar → aceitar → auditoria aparece).
Critério de pronto: suíte roda no CI (F1-07) e cobre, de ponta a ponta, o critério de aceitação da Fase 1 do PRD ("um usuário consegue criar uma organização, convidar outro usuário com um papel específico, e uma ação sensível gera um registro de auditoria").
Depende de: F1-07 até F1-17.

### Ordem de execução sugerida dentro do sprint

```
F1-01 → F1-02 → F1-03
              ↓
   F1-04 ─┬─ F1-05 ─┬─ F1-06
          │         │
          └──> F1-07 (CI) <──┘
                    ↓
        F1-08 → F1-09 → F1-10
                    ↓
   F1-11 → F1-12 → F1-13 → F1-14 → F1-15
                            ↓
                         F1-16 → F1-17 → F1-18
```

Observação: F1-06 (Next.js) pode ser feito em paralelo ao Bloco C/D se houver disposição de alternar contexto entre frontend e backend; caso contrário, adiar toda a parte de UI para depois do Bloco D reduz troca de contexto (alinhado à prática de "minimizar context switching" do processo de planejamento), já que a Fase 1 é essencialmente backend-heavy — o frontend de fato ganha conteúdo relevante a partir da Fase 2.

---

## 4. Recomendações consolidadas (ação sugerida antes de iniciar a execução)

1. Mover CI mínimo (F1-07) e rate limiting em auth (F1-10) para dentro da Fase 1, como já refletido na quebra acima.
2. Explicitar no roadmap se a execução de tools de IA (F3) é síncrona ou passa por fila desde o início — resolve a ambiguidade de quando BullMQ realmente precisa estar de pé.
3. Fazer um spike de deploy no GCP ainda durante F1/F2 (não esperar o Sprint 13) para des-riscar a Fase 6.
4. Tratar a "nota de corte de escopo" das Fases 5 e 7 como escopo-alvo desde o início, não como plano de contingência.
5. Adicionar teste manual de prompt injection logo após a Fase 4, além da suíte automatizada da Fase 7.
6. Considerar um Sprint 15 de buffer/portfolio (README, demo, polimento de UI) — hoje ausente do roadmap.
