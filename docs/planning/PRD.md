# OpsMind — PRD + Arquitetura Técnica

**AI-Powered Business Operations Platform**
Versão 1.0 — 26/08/2026

---

## 1. Visão e Branding

**Nome:** OpsMind

**Tagline:** *"Your business data shouldn't just be stored. It should work for you."*

**Posicionamento:** OpsMind não é um chatbot nem "uma plataforma de IA para empresas". É uma plataforma de **Business Operations** — CRM, tarefas, documentos e automações — onde a IA é uma camada de inteligência que lê o contexto real do negócio e age sobre ele (responde, cria tarefas, dispara automações, resume, busca).

**Frase de portfolio:**
> OpsMind is a production-oriented, multi-tenant platform that combines CRM, workflow automation, document intelligence and AI agents to help businesses turn operational data into actions.

**Por que esse conceito é mais forte que "AI SaaS genérico":** o projeto passa a demonstrar três competências simultâneas — engenharia de produto (CRM real, multi-tenant, RBAC), engenharia de backend/dados (fila, workers, eventos) e AI engineering aplicada (RAG, tool calling, evals, custo de IA, segurança de prompt) — em vez de ser só "chamei a API da OpenAI".

---

## 2. Problema

Pequenas e médias empresas (times de 3 a 50 pessoas: agências, consultorias, imobiliárias, clínicas, escritórios de serviços) têm seus dados espalhados entre planilhas, WhatsApp, e-mail e um CRM subutilizado. Três dores recorrentes:

1. **Dados existem, mas não geram ação.** Ninguém revisita clientes inativos, contratos vencendo ou tarefas esquecidas até que já seja tarde.
2. **Contexto fica na cabeça de uma pessoa.** Quando alguém sai de férias ou da empresa, o histórico do cliente some junto.
3. **Ferramentas de IA genéricas (ChatGPT, copilots soltos) não têm acesso aos dados reais da empresa**, então viram um brainstorm desconectado da operação, não uma ferramenta operacional.

**Hipótese de produto:** se a IA tiver acesso estruturado e seguro ao CRM, documentos e histórico de atividades de uma empresa, ela deixa de ser um assistente de texto e passa a ser uma camada operacional — que responde perguntas com dados reais, sugere e executa ações, e mantém tudo auditável.

---

## 3. Personas

| Persona | Papel | O que ela precisa do OpsMind |
|---|---|---|
| **Marina, dona de agência (Owner)** | Gestora, 12 funcionários | Visão consolidada do negócio, controle de custo de IA, segurança dos dados dos clientes |
| **Diego, gerente de vendas (Manager)** | Gerencia 4 vendedores | Saber quem precisa de atenção, distribuir tarefas, ver relatórios de atividade do time |
| **Julia, vendedora/CS (Member)** | Uso diário do CRM | Timeline do cliente, criar tarefas rápido, perguntar coisas à IA em vez de vasculhar planilhas |
| **Rafael, admin de TI/operações (Admin)** | Configura o workspace | RBAC, integrações, auditoria, políticas de automação |
| **Convidado externo (Viewer)** | Contador, consultor pontual | Acesso somente-leitura a um subconjunto de dados |

---

## 4. Casos de Uso Centrais

1. Como **Julia**, quero perguntar *"quais clientes não têm contato há mais de 14 dias?"* e receber uma lista real, não um chute do modelo.
2. Como **Julia**, quero pedir *"crie uma tarefa de follow-up para cada um desses clientes e atribua ao time de vendas"* e ver a IA executar isso via tool calling, não apenas descrever o que eu deveria fazer.
3. Como **Diego**, quero que quando um cliente fica "inativo" por 14 dias, uma tarefa seja criada e eu seja notificado automaticamente — sem eu precisar lembrar de checar.
4. Como **Julia**, quero fazer upload de um contrato em PDF e perguntar *"qual a cláusula de rescisão?"* e receber a resposta com a citação do trecho e do documento de origem.
5. Como **Marina**, quero ver quanto a empresa está gastando com IA este mês, por usuário, e definir um teto de orçamento.
6. Como **Rafael**, quero auditoria completa: quem viu o quê, quando a IA executou uma ação e sobre qual dado.
7. Como **Marina**, quero ter certeza de que um documento malicioso (ex.: um PDF com uma instrução escondida) não pode fazer a IA vazar dados de outro cliente.

---

## 5. Módulos do Sistema

```
Auth & Organizations   → tenants, usuários, convites, RBAC
CRM                    → customers, tags, timeline de atividade
Tasks                  → tarefas, atribuição, status, prazos
Documents              → upload, extração, chunking, embeddings
Conversations          → mensagens/e-mail (fase 2), threads
AI Assistant           → chat, contexto, tool calling, RAG
Automations            → triggers, condições, ações, execuções
Notifications          → in-app, e-mail (WhatsApp depois)
Analytics              → métricas de negócio + observabilidade de IA
Audit                  → log imutável de eventos sensíveis
```

---

## 6. Funcionalidades do MVP (o que entra na v1)

- Autenticação (e-mail/senha + verificação), sessão via JWT + refresh token
- Organizações (workspaces) multi-tenant, convite de membros, 5 papéis (Owner, Admin, Manager, Member, Viewer)
- CRM: CRUD de clientes, tags, status, notas, timeline de atividade
- Tarefas: CRUD, atribuição, prazos, status, vínculo com cliente
- Documentos: upload (PDF), extração de texto, chunking, embeddings, busca semântica com citação de fonte
- AI Assistant: chat com contexto do workspace, RAG sobre documentos e dados de CRM, tool calling (ler e criar dados)
- Automações: motor simples de trigger → condição → ação (ex.: "cliente inativo há N dias → criar tarefa + notificar")
- Notificações in-app e por e-mail
- Analytics: dashboard de negócio (clientes, tarefas, automações) + painel de uso de IA (requests, tokens, custo, latência)
- Auditoria: log de ações sensíveis (login, criação/edição/exclusão, ações executadas pela IA)
- Segurança de base: isolamento por tenant em toda query, validação de input, rate limiting, segredos fora do código

## 7. Funcionalidades Futuras (pós-MVP)

- Canais de conversa: WhatsApp (webhook) e e-mail bidirecional, com classificação automática de mensagens
- Geração automática de tarefas a partir de conversas
- Sumarização automática de threads longas
- Automações visuais tipo builder (drag-and-drop)
- AI Gateway com fallback entre provedores (OpenAI/Anthropic/Google)
- Evals automatizados de qualidade da IA (dataset de perguntas, tool selection accuracy, hallucination rate)
- Orçamento de IA por organização com alertas e corte automático
- Exportação de relatórios, integrações externas (Zapier-like), SSO/SAML para clientes enterprise

---

## 8. Regras de Negócio (principais)

- Todo dado pertence a uma `organization_id`; nenhuma query pode cruzar tenants — isso é reforçado na camada de acesso a dados, não só na aplicação.
- Um cliente é considerado **inativo** quando não há nenhuma atividade (tarefa concluída, nota, mensagem) associada a ele há mais de N dias (configurável por organização, padrão 14).
- Toda ação que a IA executa (criar/editar/excluir) precisa passar pela mesma checagem de autorização (RBAC) que um usuário humano teria — a IA nunca tem permissões acima do usuário que a invocou.
- Documentos processados viram fonte de contexto para RAG, mas conteúdo de documento **nunca é tratado como instrução** para a IA (proteção contra prompt injection) — é sempre tratado como dado.
- Toda automação tem um log de execução (sucesso/falha, o que disparou, o que foi feito) — automações são auditáveis como qualquer ação humana.
- Exclusão de cliente/documento é soft-delete com trilha de auditoria; hard-delete é uma ação administrativa separada.
- Convites expiram em 7 dias; um usuário só pode pertencer a mais de uma organização trocando de contexto explicitamente (sem misturar dados entre elas na mesma sessão).

---

## 9. Modelo de Dados Inicial (entidades principais)

```
Organization
  id, name, slug, plan, ai_monthly_budget, created_at

User
  id, email, password_hash, name, created_at

Membership
  id, user_id, organization_id, role (owner|admin|manager|member|viewer)

Customer
  id, organization_id, name, company, email, phone,
  status (active|inactive|lead), tags[], owner_user_id,
  last_activity_at, created_at

Task
  id, organization_id, customer_id (nullable), title, description,
  status (open|in_progress|done|cancelled), assignee_id, due_date,
  created_by (user|ai|automation), created_at

Document
  id, organization_id, customer_id (nullable), filename, storage_url,
  status (processing|ready|failed), created_at

DocumentChunk
  id, document_id, content, embedding (vector), chunk_index

ActivityLog  (timeline do cliente)
  id, organization_id, customer_id, type, payload, actor (user|ai|system), created_at

Automation
  id, organization_id, name, trigger, conditions, actions, enabled, created_at

AutomationRun
  id, automation_id, status, triggered_by, result, created_at

AIRequest
  id, organization_id, user_id, model, input_tokens, output_tokens,
  latency_ms, estimated_cost, tool_calls[], created_at

AuditLog
  id, organization_id, actor_type, actor_id, action, resource, metadata, created_at

Notification
  id, organization_id, user_id, type, payload, read_at, created_at
```

---

## 10. Arquitetura

### 10.1 Visão geral — Modular Monolith

Para um projeto individual, microsserviços de verdade adicionam complexidade operacional sem benefício real nesse estágio. A decisão consciente é começar com um **monolito modular** bem desenhado, com fronteiras de módulo claras o suficiente para extrair serviços depois, se houver motivo real (ex.: o worker de IA/documentos precisar escalar independente do resto).

```
                    Next.js (Web)
                        │
                        ▼
                  API (NestJS)
                        │
      ┌─────────────────┼──────────────────┐
      │                 │                  │
      ▼                 ▼                  ▼
  CRM Module        AI Module      Automation Module
      │                 │                  │
      ├─────────────────┼──────────────────┤
      ▼                 ▼                  ▼
  PostgreSQL          Redis              Queue (BullMQ)
  (+ pgvector)                              │
                                        Workers
                              (documentos, automações, IA)
```

### 10.2 Estrutura de módulos (backend)

```
src/
├── modules/
│   ├── auth/
│   ├── organizations/
│   ├── users/
│   ├── customers/
│   ├── tasks/
│   ├── documents/
│   ├── conversations/          (fase 2)
│   ├── ai/
│   ├── automations/
│   ├── notifications/
│   ├── analytics/
│   └── audit/
├── infrastructure/
│   ├── database/
│   ├── queue/
│   ├── storage/
│   ├── ai/                     (AI Gateway: providers, retry, fallback)
│   └── email/
└── shared/
    ├── guards/                 (RBAC, tenant isolation)
    ├── decorators/
    └── pipes/
```

### 10.3 Camada de IA (Context Engine + Tool Calling)

```
                    USER
                      │
                      ▼
                AI ASSISTANT
                      │
                Context Engine
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
    CRM Data       Documents      Activities
       │              │              │
       └──────────────┼──────────────┘
                       ▼
                 RAG (pgvector)
                       │
                       ▼
                Intent + Tool Selection
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
 getCustomers()   createTask()   searchDocuments()
       │               │               │
       └───────────────┼───────────────┘
                       ▼
                Authorization Check (RBAC)
                       │
                       ▼
                  Tool Execution
                       │
                       ▼
                  AI Response + Audit Log
```

**Princípio de segurança:** toda tool tem um contrato explícito de permissões (read/write/delete) e passa pelo mesmo `AuthorizationGuard` usado nas rotas HTTP normais. A IA nunca chama o banco diretamente — ela só tem acesso ao conjunto de tools expostas, cada uma já filtrada por `organization_id` e pelo papel do usuário que iniciou a conversa.

### 10.4 Automações (event-driven)

```
Trigger (ex: customer.status_changed)
        │
        ▼
Condition (ex: inactive > 14 days)
        │
        ▼
Action (ex: create_task + notify)
        │
        ▼
AutomationRun (log de execução)
```

Implementado com eventos internos (event emitter) publicando na fila (BullMQ/Redis), consumidos por workers dedicados — isso já demonstra arquitetura orientada a eventos sem precisar de um message broker externo mais pesado (Kafka) neste estágio.

---

## 11. Endpoints (amostra representativa)

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /organizations
POST   /organizations/:id/invite

GET    /customers
POST   /customers
GET    /customers/:id
PATCH  /customers/:id
GET    /customers/:id/timeline

GET    /tasks
POST   /tasks
PATCH  /tasks/:id

POST   /documents            (upload)
GET    /documents/:id
GET    /documents/:id/status

POST   /ai/chat              (streaming)
GET    /ai/usage

POST   /automations
GET    /automations
POST   /automations/:id/run  (execução manual/teste)

GET    /analytics/overview
GET    /audit-logs
```

---

## 12. Eventos e Filas (BullMQ)

```
Queue: document-processing
  → extract-text, chunk, embed, index

Queue: automation-execution
  → evaluate-trigger, run-action, log-result

Queue: ai-tool-execution
  → execute-tool, persist-audit-log

Queue: notifications
  → send-email, send-in-app
```

Cada job carrega `organization_id` obrigatoriamente — isso evita que um worker processe ou vaze dado de um tenant errado por engano.

---

## 13. Estratégia de IA / RAG

- **AI Gateway** próprio (não acoplar a aplicação a um único provider): interface comum sobre OpenAI/Anthropic, com retry e possibilidade de fallback.
- **RAG:** PostgreSQL + `pgvector` no MVP (evita subir um vector DB separado cedo). Pipeline: upload → extração de texto → chunking (por parágrafo/tamanho fixo com overlap) → embeddings → `DocumentChunk` → busca por similaridade no momento da pergunta → resposta com citação da fonte.
- **Tool calling:** conjunto pequeno e bem testado de tools no MVP (`get_customer`, `search_customers`, `create_task`, `search_documents`, `get_customer_activity`) — melhor ter 5 tools confiáveis do que 20 instáveis.
- **Observabilidade de IA:** todo request de IA grava `AIRequest` (tokens, custo estimado, latência, tools chamadas) — isso alimenta o painel de analytics e é o dado usado nos evals.
- **Evals (fase final):** dataset curado de perguntas com tool/resposta esperada, rodado como suite automatizada, medindo tool selection accuracy, retrieval accuracy, hallucination rate, custo e latência.

---

## 14. Segurança

**Autenticação:** senha com hash (bcrypt/argon2), JWT de curta duração + refresh token, verificação de e-mail, fluxo de reset de senha.

**Autorização:** RBAC com 5 papéis (Owner > Admin > Manager > Member > Viewer), checado tanto nas rotas HTTP quanto nas tools de IA.

**Isolamento de dado:** `organization_id` obrigatório em toda query (idealmente reforçado por uma camada/guard central, não deixado a critério de cada desenvolvedor lembrar).

**Proteção de infraestrutura:** rate limiting, validação de input (Zod/class-validator), segredos via variáveis de ambiente/secret manager (nunca no código), dados sensíveis criptografados em repouso, URLs de arquivo assinadas e temporárias.

**Segurança de IA (diferencial do projeto):**
- **Prompt injection:** conteúdo vindo de documentos ou mensagens externas é sempre injetado no prompt como *dado delimitado*, nunca concatenado como instrução; um teste automatizado no eval suite tenta ativamente quebrar essa barreira (ex.: documento contendo "ignore previous instructions...").
- **Least privilege para tools:** a IA só executa o que o usuário que a invocou poderia executar manualmente.
- **Auditoria:** toda ação da IA (leitura sensível, escrita, exclusão) é logada como um `AuditLog` com o mesmo nível de detalhe de uma ação humana.

---

## 15. Stack Técnica

| Camada | Escolha | Por quê |
|---|---|---|
| Frontend | Next.js + TypeScript, Tailwind, shadcn/ui, React Query, Zod | Produtividade + type-safety ponta a ponta |
| Backend | NestJS + TypeScript | Arquitetura modular explícita, DI, guards prontos para RBAC |
| Banco de dados | PostgreSQL + Prisma | Relacional robusto, migrations versionadas |
| Vector search | pgvector (no próprio Postgres) | Evita infra extra cedo; migrável para um vector DB dedicado depois |
| Cache / Fila | Redis + BullMQ | Padrão de mercado em Node, simples de operar sozinho |
| Storage de arquivos | Google Cloud Storage | URLs assinadas, barato, integra bem com GCP |
| IA | AI Gateway próprio sobre OpenAI/Anthropic | Evita lock-in de provider |
| Infra | Docker + Terraform + GCP | Infra como código, reproduzível |
| CI/CD | GitHub Actions | Padrão, gratuito para projeto pessoal |
| Observabilidade | Sentry + logging estruturado | Erros + métricas mínimas de produção |

---

## 16. Estrutura de Monorepo

```
opsmind/
├── apps/
│   ├── web/              (Next.js)
│   └── api/               (NestJS)
├── packages/
│   ├── database/          (Prisma schema + client)
│   ├── shared-types/       (DTOs/tipos compartilhados)
│   └── config/             (eslint, tsconfig, env schema)
├── infra/
│   ├── docker/
│   └── terraform/
└── .github/workflows/
```

---

## 17. Roadmap por Sprints

Dimensionado para ritmo **part-time consistente (~15–25h/semana)**, sprints de 2 semanas. Total estimado: **~14 sprints (≈ 7 meses)** até uma v1 apresentável em portfolio; dá para cortar escopo e chegar a uma demo honesta bem antes disso se necessário (ver nota no fim).

**Fase 1 — Foundation (Sprints 1–2)**
Monorepo, Docker Compose local, Prisma + schema inicial, Auth (registro/login/refresh), Organizations + Membership + RBAC básico, Audit log mínimo.
*Critério de aceitação:* um usuário consegue criar uma organização, convidar outro usuário com um papel específico, e uma ação sensível gera um registro de auditoria.

**Fase 2 — Core Product (Sprints 3–5)**
CRUD de Customers com tags/status, timeline de atividade, CRUD de Tasks vinculadas a clientes, Dashboard inicial, notificações in-app.
*Critério de aceitação:* criar um cliente, registrar atividades nele, criar e concluir uma tarefa, e ver tudo refletido na timeline e no dashboard.

**Fase 3 — AI Assistant + Tool Calling (Sprints 6–8)**
AI Gateway (1 provider), chat com contexto do workspace, 5 tools iniciais (`get_customer`, `search_customers`, `create_task`, `get_customer_activity`, `list_tasks`), `AIRequest` logging.
*Critério de aceitação:* perguntar "quais clientes sem contato há 14 dias?" retorna dado real via tool call, e pedir para criar tarefas para eles funciona de ponta a ponta com auditoria.

**Fase 4 — Documents + RAG (Sprints 9–10)**
Upload de PDF, extração de texto, chunking, embeddings, pgvector, busca semântica com citação de fonte na resposta da IA.
*Critério de aceitação:* perguntar sobre o conteúdo de um contrato enviado retorna resposta correta citando o trecho/documento de origem.

**Fase 5 — Automations (Sprints 11–12)**
Motor trigger → condição → ação, fila BullMQ, worker de execução, log de `AutomationRun`, automação padrão de "cliente inativo".
*Critério de aceitação:* um cliente sem atividade há N dias dispara automaticamente criação de tarefa + notificação, visível no log de execução.

**Fase 6 — Production Readiness (Sprint 13)**
Docker para produção, CI/CD (GitHub Actions), deploy em GCP, Terraform básico, rate limiting, Sentry, logging estruturado.
*Critério de aceitação:* deploy reproduzível via pipeline, com monitoramento de erro ativo.

**Fase 7 — AI Engineering Polish (Sprint 14)**
Painel de custo/uso de IA por organização e usuário, orçamento mensal configurável, dataset de evals (10–20 casos) com script de execução e métricas (tool accuracy, hallucination rate, custo, latência), teste de prompt injection.
*Critério de aceitação:* README/demo mostra o painel de custo de IA e os resultados do eval suite rodando via CI.

**Nota sobre corte de escopo:** se o prazo apertar, a versão "demo honesta" mínima corta Conversations/WhatsApp (já fora do MVP), reduz Automations a 1-2 regras fixas (sem builder), e reduz o eval suite a 10 casos — ainda assim entrega os quatro pilares (CRM real + RAG + tool calling + observabilidade de IA) que sustentam a conversa em entrevista.

---

## 18. Critérios de Aceitação Gerais (nível produto)

1. Um usuário novo consegue se cadastrar, criar uma organização e convidar um colega com um papel restrito, e esse colega não consegue ver dados de outra organização.
2. Um cliente pode ser criado, ter atividades registradas e aparecer corretamente na timeline e no dashboard.
3. A IA responde perguntas sobre os dados reais do workspace (não inventa números) e cita a fonte quando a resposta vem de um documento.
4. A IA consegue executar uma ação real (criar tarefa) apenas quando o usuário que a invocou teria permissão para fazer isso manualmente.
5. Uma automação configurada dispara sem intervenção manual e fica registrada em log.
6. O painel de analytics mostra, com dados reais do próprio uso, quantos requests de IA foram feitos, custo estimado e latência média.
7. Um teste de prompt injection (documento com instrução maliciosa embutida) não consegue alterar o comportamento da IA além do escopo da pergunta feita.
8. O sistema tem pipeline de CI/CD funcional e está deployado em ambiente acessível para demonstração.
