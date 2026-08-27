# Review de Arquitetura — OpsMind PRD v1.0

**Revisor:** architect (Software Architecture Specialist)
**Escopo:** Seções 5, 9, 10 (10.1–10.4), 12, 13, 16 e 17 do PRD — decisão de monolito modular, fronteiras de módulo, pontos de extração futura, acoplamento entre módulos e adequação da escala planejada para ~14 sprints solo/part-time.
**Natureza:** Revisão somente de análise. Nenhum arquivo de código foi criado ou alterado.

---

## Resumo

A decisão de monolito modular (10.1) está correta para este estágio — um desenvolvedor solo, part-time, com 14 sprints, não deveria pagar o custo operacional de microsserviços reais (deploy múltiplo, tracing distribuído, falhas de rede parciais) sem benefício de escala real. As fronteiras de módulo propostas são majoritariamente sãs e o ponto de extração futura mais óbvio — o worker de documentos/IA — já está corretamente isolado atrás de filas BullMQ no diagrama.

Dito isso, a revisão encontrou **cinco lacunas concretas** que, se não endereçadas agora, viram dívida cara depois: (1) o monorepo (seção 16) não reserva um `apps/worker` separado, o que contradiz a própria premissa de "extrair depois" — sem processo desacoplado desde o início, não há nada para extrair; (2) a execução de tools de IA aparece tanto como síncrona (chat streaming) quanto como fila assíncrona (`ai-tool-execution`), sem essa contradição resolvida — isso vai custar tempo não planejado na Fase 3; (3) o isolamento multi-tenant é descrito como "idealmente" reforçado por uma camada central (linguagem de intenção, não de garantia), o que é inaceitável para o dado mais crítico do produto; (4) Auth, Organizations e Users são três módulos com dependências prováveis em ambas as direções, sem uma regra explícita de quem depende de quem; (5) toda a infraestrutura de deploy/CI é empurrada para o Sprint 13, criando um risco de integração "big bang" tardio em um projeto solo com orçamento de tempo apertado.

Nenhum desses pontos exige revisitar a decisão de monolito modular — são ajustes dentro da mesma arquitetura, a maioria de baixo custo se feitos agora e caros se descobertos depois.

---

## Pontos fortes

1. **Monolito modular é a escolha certa para o contexto.** Um projeto pessoal/portfolio com 1 desenvolvedor part-time não tem massa crítica de time nem de tráfego para justificar microsserviços reais. A PRD já articula essa justificativa corretamente na seção 10.1 — a fronteira de módulo dentro do monolito (via módulos NestJS + DI) já sinaliza a mesma maturidade arquitetural para quem for avaliar o portfolio, sem o custo operacional de N pipelines de deploy, service mesh, e debugging de rede distribuída.

2. **O melhor candidato a extração futura (worker de documentos/IA) já está desenhado com a costura certa.** O pipeline de documentos (extract → chunk → embed → index) já está isolado atrás da fila `document-processing` (seção 12), consumido por um worker dedicado no diagrama (10.1). É exatamente o padrão certo: processamento pesado, potencialmente CPU/IO-bound, desacoplado do request/response HTTP desde o desenho inicial — o que barateia muito uma futura extração para um serviço separado (potencialmente até outro runtime, ex. Python, se bibliotecas de PDF/embeddings pedirem).

3. **Automações como arquitetura orientada a eventos, sem infraestrutura pesada prematura.** Usar event emitter interno publicando em BullMQ/Redis (10.4) entrega o padrão "event-driven" que o projeto quer demonstrar em portfolio, sem introduzir Kafka ou um broker externo que nenhum projeto desse porte precisa neste estágio. Decisão consciente e bem justificada no próprio PRD.

4. **`organization_id` obrigatório em todo job de fila (seção 12) é o padrão certo para evitar vazamento cross-tenant em processamento assíncrono** — esse é exatamente o tipo de disciplina que normalmente falha primeiro em sistemas multi-tenant (o request HTTP tem guard, mas o worker que processa a fila esquece o filtro). Bom que já esteja explícito como regra de design.

5. **RAG com pgvector no próprio Postgres (13, 15) evita infraestrutura extra cedo** e é migrável depois para um vector DB dedicado se o volume justificar — decisão de escala apropriada, mesmo raciocínio do worker de documentos: adiar a complexidade até que haja motivo real.

6. **Least-privilege para tools de IA (10.3, 14) é bem desenhado no papel**: a IA nunca acessa o banco diretamente, só um conjunto pequeno de tools já filtradas por `organization_id` e papel, passando pelo mesmo `AuthorizationGuard` das rotas HTTP. Isso evita a "porta dos fundos" mais comum em sistemas de IA ag250êntica (a IA com mais poder que o usuário que a invocou).

7. **Escopo de tools de IA deliberadamente pequeno no MVP** ("5 tools confiáveis em vez de 20 instáveis", seção 13) é uma decisão de engenharia madura — resiste à tentação de expandir a superfície de tool calling antes de ter confiabilidade comprovada.

---

## Riscos / Preocupações

### R1. O monorepo não reserva um processo de worker separado — a "extração futura" não tem onde acontecer
A seção 16 define apenas `apps/web` e `apps/api`. O diagrama da seção 10.1 desenha "Workers" como uma caixa distinta de "API", mas nada na estrutura de monorepo garante que os consumers do BullMQ (`document-processing`, `automation-execution`, `ai-tool-execution`, `notifications`) rodem como um processo/deployment separado desde o início. Se os processors do BullMQ forem registrados dentro do próprio `apps/api` (padrão comum com `@nestjs/bullmq`), a "extração para serviço separado" citada na seção 10.1 como motivação da arquitetura vira um refactor real no Sprint 13 (Production Readiness), sob pressão de prazo, em vez de "só aumentar réplicas de um processo que já existe". Isso é uma inconsistência entre a intenção arquitetural declarada e a estrutura de projeto proposta.

### R2. Execução de tools de IA: síncrona (chat streaming) vs. assíncrona (fila `ai-tool-execution`) — não reconciliado
A seção 10.3 descreve o fluxo de tool calling como parte do ciclo de resposta da IA (Intent → Tool Selection → Authorization → Tool Execution → AI Response), e `POST /ai/chat` é explicitamente streaming (seção 11). Mas a seção 12 define uma fila BullMQ `ai-tool-execution` com jobs `execute-tool, persist-audit-log`, sugerindo execução assíncrona. Essas duas descrições não se conciliam sem uma decisão explícita: se o tool call precisa completar antes da IA formular a resposta final (padrão usual de tool calling), colocá-lo numa fila assíncrona exige um mecanismo de "esperar o job terminar e retomar o stream" (ex.: pub/sub no Redis sinalizando de volta para a conexão SSE aberta) — complexidade real, não mencionada em nenhum lugar do documento. Isso é o tipo de ambiguidade que custa dias não planejados quando descoberta no meio da Fase 3 (Sprints 6–8).

### R3. Isolamento multi-tenant descrito como intenção, não como garantia
A seção 8 diz que o isolamento é "reforçado na camada de acesso a dados, não só na aplicação" — correto — mas a seção 14 enfraquece isso: "idealmente reforçado por uma camada/guard central". A palavra "idealmente" é um sinal de risco em um documento de arquitetura para o dado mais crítico do produto (isolamento cross-tenant). Dado que o caso de uso #7 do próprio PRD (seção 4) é justamente sobre um documento malicioso tentando vazar dados de outro cliente via prompt injection, a superfície de risco de vazamento cross-tenant é ainda maior do que em um CRM comum (o vetor de ataque não é só "esquecer um `WHERE organization_id`" em uma query manual — é também a IA sendo manipulada para chamar uma tool sem o filtro correto). Isso merece tratamento como requisito não-negociável, com mecanismo de imposição no nível de dado (não só de aplicação), não como aspiração.

### R4. Auth, Organizations e Users como três módulos sem direção de dependência explícita
`Membership` (seção 9) une `User`, `Organization` e `role` — é uma entidade que naturalmente cria acoplamento bidirecional entre os três módulos: Auth precisa de User para autenticar; Organizations precisa de User+Membership para RBAC; Users pode precisar de Organizations para contexto multi-tenant (troca de workspace, seção 8). Sem uma regra explícita de "quem importa o quê", esses três módulos tendem a desenvolver dependências circulares no NestJS DI (`AuthModule` importa `UsersModule` que importa `OrganizationsModule` que precisa voltar para `AuthModule` para checar sessão, etc.), o que é exatamente o tipo de acoplamento que a seção 10.1 diz que o monolito modular deveria evitar através de "fronteiras claras".

### R5. Toda a infraestrutura de deploy/CI/observabilidade concentrada no Sprint 13
Da Fase 1 até a Fase 5 (Sprints 1–12), o projeto inteiro é construído sem nunca ter sido implantado em um ambiente real (Docker de produção, CI/CD, GCP, Terraform e Sentry só entram na Fase 6, Sprint 13). Para um time de 1 pessoa part-time, isso é risco de integração "big bang" no pior momento possível: qualquer surpresa de infraestrutura (variáveis de ambiente, permissões de storage assinado, latência real de fila em produção, custo de IA real vs. estimado) aparece exatamente no penúltimo sprint, comendo o orçamento de tempo do Sprint 14 (polish final, que já é o sprint onde o "diferencial de portfolio" — evals, painel de custo — precisa ficar pronto para demo).

### R6. Módulo `ai` como potencial "hub" de dependências (god-module por fan-out)
As tools do MVP (`get_customer`, `search_customers`, `create_task`, `search_documents`, `get_customer_activity`, `list_tasks`) tocam praticamente todos os outros módulos de domínio (customers, tasks, documents, activity/audit). Isso é esperado para um módulo de orquestração de IA, mas o PRD não especifica se as tools chamam **serviços de aplicação públicos** dos outros módulos (contrato estável, baixo acoplamento) ou se acessam repositórios/dados internos diretamente (acoplamento estrutural forte). Sem essa regra explícita, o módulo `ai` tende a crescer como um "God Object" à medida que mais tools forem adicionadas pós-MVP (seção 7 já prevê expansão), tornando qualquer refactor de CRM/Tasks/Documents arriscado por efeito colateral na camada de IA.

### R7. Audit como módulo de feature, não como concern transversal
`AuditLog` precisa ser escrito por praticamente todo módulo (login, CRUD sensível, ações de IA, execuções de automação). Modelar `audit` como um módulo de domínio comum (seção 10.2, lista lado a lado com `customers`, `tasks` etc.) tende a gerar um padrão de "todo módulo importa `AuditModule`", o que é aceitável desde que a direção seja estritamente unidirecional (todos → audit, nunca o contrário) e que `AuditModule` não acumule lógica de negócio que precise importar de volta `OrganizationsModule`/`UsersModule` para enriquecer o log — isso criaria um ciclo. O PRD não deixa essa regra explícita.

### R8. Imutabilidade do audit log é declarada, não imposta
Seção 8: "log imutável de eventos sensíveis". Nada no desenho técnico (10.2–14) descreve *como* essa imutabilidade é garantida — hoje é apenas convenção de código (ninguém chama `UPDATE`/`DELETE` no `AuditLog`). Para um artefato que o PRD explicitamente posiciona como diferencial de portfolio ("Segurança de IA — diferencial do projeto", seção 14), vale a pena que a imutabilidade tenha alguma imposição real (grants de banco, tabela append-only, ou hashing encadeado), não só disciplina de desenvolvedor.

### R9. Sessão/JWT multi-organização e o risco de token "cross-tenant"
Seção 8: um usuário só pode pertencer a mais de uma organização "trocando de contexto explicitamente (sem misturar dados entre elas na mesma sessão)". Isso é uma regra de negócio correta, mas o desenho técnico não especifica o mecanismo (o JWT carrega um único `organization_id` por token? trocar de org exige reemitir o token?). Se um token antigo continuar válido para uma organização diferente da que a UI está mostrando, isso é um vetor real de vazamento cross-tenant — a mesma categoria de risco do R3, só que na camada de sessão em vez de query.

### R10. Inconsistência de escopo: orçamento de IA como caso de uso central vs. pós-MVP
O caso de uso #5 (seção 4) atribui à persona Marina o desejo de "definir um teto de orçamento" de IA. A seção 6 (escopo do MVP) só entrega visibilidade (painel de uso/custo), e a seção 7 (pós-MVP) lista explicitamente "Orçamento de IA por organização com alertas e corte automático" como funcionalidade futura. Isso não é um problema arquitetural em si, mas é uma inconsistência de escopo entre seções do PRD que vale alinhar antes da Fase 7 — se o corte automático de orçamento for esperado como parte da "demo honesta", ele precisa de desenho técnico (quem intercepta a chamada de IA quando o teto estoura? Isso é um guard no `ai` module ou uma verificação no AI Gateway?) que hoje não existe em lugar nenhum do documento.

### R11. Nenhuma fronteira reservada para canais/integrações futuras (WhatsApp, webhooks, Zapier-like)
A seção 5 já reserva `Conversations` (fase 2) como módulo, o que é bom. Mas a seção 7 também prevê webhook de WhatsApp, e-mail bidirecional e integrações estilo Zapier — nenhum desses tem uma fronteira de módulo sequer nomeada (nem como placeholder). Não é urgente para o MVP, mas vale decidir agora se esses recursos entram dentro de `Conversations` ou merecem um módulo `integrations`/`channels` próprio, para não fazer `Conversations` virar um dumping ground de responsabilidades não relacionadas (mensageria + webhooks externos + parsing de e-mail são preocupações bem diferentes).

---

## Recomendações concretas (priorizadas)

### Prioridade Alta — endereçar antes/durante a Fase 1–3

1. **Adicionar um processo de worker desacoplado desde o início.** Criar `apps/worker` no monorepo (ou, no mínimo, um bootstrap alternativo em `apps/api` que rode em "modo worker" via flag/variável de ambiente, mas empacotado e deployado como um processo/container separado desde a Fase 4, quando o processamento de documentos entra em cena). Isso torna a "extração futura" real: escalar o worker independentemente do resto passa a ser "subir mais réplicas de um deployment que já existe", não um refactor.

2. **Resolver, por ADR, o modelo de execução das tools de IA antes da Fase 3.** Decisão recomendada: executar as tools **de forma síncrona dentro do handler do `/ai/chat`** (a maioria são leituras/escritas rápidas no Postgres, dentro do orçamento de latência de um stream), usando a fila `ai-tool-execution` apenas para o `persist-audit-log` assíncrono (fire-and-forget, não bloqueia o stream). Reservar execução via fila real só para uma tool futura que comprovadamente precise (lenta, externa, sujeita a retry). Documentar essa decisão explicitamente — é exatamente o tipo de ambiguidade que gera retrabalho quando descoberta em código.

3. **Tratar isolamento multi-tenant como requisito de imposição, não de intenção.** Implementar via: (a) middleware/extension do Prisma que injeta `organization_id` automaticamente em toda query dos módulos de domínio; (b) Postgres Row-Level Security como camada de defesa adicional (defense-in-depth) nas tabelas multi-tenant, não apenas o guard da aplicação; (c) uma suíte de testes automatizados dedicada — "tenant isolation fuzzer" — que tenta acessar dados de outra organização em cada endpoint e em cada tool de IA, rodando no CI desde a Fase 1/2, não deixada só para o eval suite da Fase 7.

4. **Definir e documentar a direção de dependência entre `auth`, `users` e `organizations`.** Regra sugerida: `users` não depende de `organizations`; `organizations` depende de `users` (para popular `Membership`); `auth` depende de ambos apenas através de interfaces/serviços públicos, nunca o inverso. Vale registrar isso como ADR curto — evita que o NestJS DI acumule importações circulares silenciosamente à medida que features são adicionadas.

5. **Antecipar um pipeline mínimo de deploy/CI para um "walking skeleton" já no Sprint 2–3**, mesmo que rudimentar (um único serviço Cloud Run + banco gerenciado, sem Terraform completo ainda), em vez de concentrar toda a Fase 6 (deploy real, CI/CD, Terraform, Sentry) no Sprint 13. Isso move a descoberta de problemas de infraestrutura para um momento em que ainda há tempo de sprint sobrando, em vez do momento de menor margem do roadmap inteiro.

### Prioridade Média — endereçar durante Fase 3–5

6. **Definir a regra de acesso do módulo `ai` aos demais módulos**: tools de IA devem chamar apenas os serviços de aplicação públicos de `customers`/`tasks`/`documents` (a mesma camada de serviço usada pelos controllers HTTP), nunca repositórios internos diretamente. Isso mantém o `ai` module como orquestrador fino em vez de virar um god-module conforme mais tools forem adicionadas pós-MVP.

7. **Modelar `audit` como serviço injetável transversal (em `shared/` ou `infrastructure/`), não como módulo de feature paritário** com `customers`/`tasks`. Direção de dependência estritamente unidirecional: todo módulo pode chamar `AuditService`; `AuditService` nunca importa de volta módulos de domínio.

8. **Impor imutabilidade do audit log no nível de banco** — revogar `UPDATE`/`DELETE` do role de aplicação sobre a tabela `audit_log` (ou equivalente), já que essa é a peça que o próprio PRD chama de diferencial de portfolio; vale a garantia ser real, não só convencional.

9. **Especificar o mecanismo de sessão multi-organização**: JWT escopado a exatamente um `organization_id` por vez; troca de organização exige reemissão de token (não apenas troca de estado no front-end). Documentar isso junto com o guard de tenant isolation (item 3), já que são a mesma superfície de risco.

10. **Combinar o filtro de tenant e o filtro de soft-delete em uma única extensão/middleware do Prisma**, reutilizada por todos os módulos — reduz a chance de um desenvolvedor (ou você mesmo, sob pressão de prazo) esquecer um dos dois filtros em uma query nova.

### Prioridade Baixa — revisitar depois do MVP ou quando o sinal de escala aparecer

11. **Alinhar seção 4 (casos de uso) com seções 6/7 quanto ao orçamento de IA**: decidir explicitamente se o corte automático de orçamento é MVP ou pós-MVP, e caso seja MVP, desenhar onde a checagem de teto acontece (AI Gateway vs. guard no módulo `ai`) antes da Fase 7.

12. **Reservar nome de módulo/fronteira para canais e integrações externas** (`integrations` ou `channels`) para WhatsApp/webhooks/Zapier-like futuros, evitando que tudo caia dentro de `Conversations` por padrão.

13. **Monitorar a carga de leitura do módulo `analytics` sobre o Postgres primário** conforme o volume de dados cresce ao longo dos sprints; nada a fazer agora, mas se os dashboards começarem a competir com tráfego OLTP, considerar read replica ou materialized views — não é um problema para o volume esperado em 14 sprints de portfolio, apenas uma nota para o "próximo estágio" (equivalente ao que a seção 10.1 do agente architect chama de "100K usuários").

14. **Módulo de billing/assinatura não está modelado** (existe o campo `plan` em `Organization`, mas nenhuma lógica associada) — aceitável para o escopo de portfolio; sinalizar apenas caso monetização real vire objetivo do projeto.

---

## Conclusão

A arquitetura proposta é sólida na decisão estrutural mais importante (monolito modular em vez de microsserviços prematuros) e já demonstra boa disciplina em pontos que costumam falhar em projetos multi-tenant com IA (filas carregando `organization_id`, tools de IA com least-privilege, RAG sem infraestrutura extra cedo). Os riscos levantados aqui não são motivo para reconsiderar a decisão de monolito — são lacunas de especificação e sequenciamento que, resolvidas agora (a maioria via ADRs curtos, sem código), evitam retrabalho caro nas fases finais do roadmap, especialmente dado o orçamento de tempo apertado de um projeto solo part-time em 14 sprints.
