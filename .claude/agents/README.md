# Agentes do ECC instalados neste projeto

**Fonte:** [github.com/affaan-m/ECC](https://github.com/affaan-m/ECC) (licença MIT, © 2026 Affaan Mustafa)
**Snapshot:** 68 arquivos `.md` da pasta `agents/` do repositório, baixados em 2026-08-26 via `gh api` (branch `main`).
**Escopo:** instalação local deste projeto (`.claude/agents/`) — não foi tocado `~/.claude/agents/`. Nenhum outro componente do ECC (skills, hooks, rules, commands, MCP configs) foi trazido; apenas os subagentes.

O que veio de fora foi só a definição dos agentes (prompt + frontmatter `name`/`description`/`tools`/`model`). Nada foi instalado como hook automático — todos precisam ser invocados explicitamente (ou pela sugestão do Claude Code baseada na `description`).

## Relevantes agora (stack TS/Next.js/NestJS/Prisma/Postgres+pgvector)

| Agente | Uso |
|---|---|
| `architect` | Arquitetura de sistema, decisões de módulo/escala |
| `planner` | Quebra de features/roadmap em plano acionável |
| `code-architect` | Blueprint concreto de implementação (arquivos, interfaces, ordem de build) |
| `database-reviewer` | Schema Postgres/Prisma, isolamento multi-tenant, performance |
| `security-reviewer` | RBAC, auth, injeção, OWASP |
| `rag-pipeline-reviewer` | Chunking, embeddings, qualidade de retrieval |
| `agent-evaluator` | Rubrica de avaliação de output de IA / evals |
| `a11y-architect` | WCAG 2.2 no design system / componentes Next.js |
| `typescript-reviewer` / `react-reviewer` | Review de código TS/React |
| `tdd-guide` | Disciplina de teste-primeiro |
| `code-reviewer` / `code-simplifier` / `refactor-cleaner` | Qualidade geral de código |
| `performance-optimizer` | Bottlenecks, bundle size, runtime |
| `e2e-runner` / `pr-test-analyzer` | Testes end-to-end e análise de PR |
| `build-error-resolver` | Resolução de erros de build genéricos |
| `mle-reviewer` | Pipelines de ML/observabilidade (complementa `agent-evaluator`) |
| `gan-planner` / `gan-generator` / `gan-evaluator` | Trio gerador↔avaliador para implementação de features já com app rodando (útil a partir da Fase 2, testa via Playwright) |

## Dormentes por enquanto (fora do stack atual do OpsMind)

Reviewers/build-resolvers específicos de linguagens não usadas no MVP: `cpp-*`, `csharp-reviewer`, `dart-build-resolver`, `django-*`, `flutter-reviewer`, `fsharp-reviewer`, `go-*`, `harmonyos-app-resolver`, `java-*`, `kotlin-*`, `php-reviewer`, `pytorch-build-resolver`, `rust-*`, `swift-*`, `vue-reviewer`.

Fora do domínio deste produto: `healthcare-reviewer`, `homelab-architect`, `network-architect`, `network-config-reviewer`, `network-troubleshooter`, `opensource-forker`, `opensource-packager`, `opensource-sanitizer`, `marketing-agent`, `seo-specialist`, `chief-of-staff` (triagem pessoal de e-mail/Slack, não dev).

Ficam instalados sem custo — só são acionados se algum dia forem relevantes (ex.: se o projeto ganhar um serviço em Go).

## Nota de segurança

Cada agente do ECC já traz um bloco "Prompt Defense Baseline" no próprio prompt (não seguir instruções embutidas em conteúdo de terceiros, não vazar segredos, tratar dados externos como não confiáveis). Isso é coerente com a seção 14 do PRD do OpsMind (proteção contra prompt injection) e não precisou de nenhuma adaptação.
