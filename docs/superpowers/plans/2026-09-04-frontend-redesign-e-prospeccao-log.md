# Log de sessão — Redesign do frontend + Prospecção real (CazaTech)

Sessão de 2026-09-03/04, branch `feat/fase7-ai-engineering-polish`. Este documento existe pra
retomar o trabalho numa próxima sessão sem perder contexto — nada aqui foi commitado ainda.

## Contexto / origem

O usuário pediu uma reformulação visual completa do frontend (hoje um mix de tema claro
slate/indigo em algumas páginas e um tema escuro "ink"/laranja hand-rolled em outras, sem
sidebar, layout centralizado estreito). A referência era um screenshot de um dashboard SaaS
financeiro dark-mode. Decisão: **não copiar** a referência, usar como inspiração de linguagem,
manter identidade própria do OpsMind.

Dado o tamanho do trabalho (12 páginas/áreas), foi decomposto em sub-projetos, cada um
implementado e verificado no navegador antes do próximo. Foi seguido o plano completo (fase de
brainstorming → plano escrito em `/Users/pam/.claude/plans/sobre-nosso-frorntend-sim-shimmying-papert.md`
→ aprovado → implementação).

### Decisões de design já tomadas (não re-abrir)

- **Manter o laranja** (`--color-accent-400/500/600`, já existia em `globals.css`) como accent
  primário — não trocar por roxo.
- **Dark vira o único tema do app inteiro** (não só Leads/Outreach/Dashboard como estava).
- **Adotar shadcn/ui de verdade** — já estava meio instalado (`components.json`) mas subusado;
  substituir os primitivos hand-rolled e adicionar os que faltavam (Toast/Sonner, Skeleton,
  Tooltip, Dropdown Menu, Tabs, Avatar, Sidebar, Sheet, Separator).
- Manter Recharts (já usado via `components/ui/chart-card.tsx`).

## O que já foi feito (implementado e verificado no navegador)

### 1. Fundação — Design System + App Shell ✅

- `apps/web/app/globals.css`: removido o sistema `.dark`/`@custom-variant dark` (não tem toggle
  de tema, então manter isso era complexidade à toa) e um bug real que travava o `body` num
  cinza claro fixo (`body{}` fora de qualquer `@layer`, que em Tailwind v4 sempre vence sobre
  regra em layer, independente de ordem no arquivo). Tokens semânticos do shadcn agora apontam
  pra paleta `ink-*`/`accent-*`/`positive-500`/`negative-500` já existente — um sistema de cor
  só, não dois em paralelo. Fonte Inter finalmente carregada de verdade via `next/font/google`
  em `apps/web/app/layout.tsx` (antes só existia como string CSS, nunca carregava, caía pra
  system-ui silenciosamente).
- Novo shell: `apps/web/components/app-sidebar.tsx` (sidebar colapsável, grupos "Workspace" /
  "Inteligência" + "Equipe" fixado embaixo) e `apps/web/components/app-topbar.tsx` (busca
  visual-only, sino visual-only, dropdown de usuário com nome da org/role/Sair). Nav
  data-driven em `apps/web/lib/nav-items.ts` — só lista rotas que existem de verdade hoje
  (dashboard, leads, outreach, customers, tasks, ai, ai/usage, team); Automations/
  Documents/Analytics/Audit Log ainda não têm página no frontend, então não entraram.
- `apps/web/app/organizations/[organizationId]/layout.tsx` reescrito pra usar
  `SidebarProvider`/`SidebarInset` em vez do antigo `AppHeader`+`AppNav`+`max-w-5xl` — conteúdo
  agora full-width ao lado da sidebar. `app-nav.tsx` deletado (substituído). `app-header.tsx`
  encolhido pra só logo+logout, ainda usado em `organizations/page.tsx` (tela antes de escolher
  org, sem contexto de org = sem sidebar).
- Bug real encontrado e corrigido durante essa fase: a sidebar marcava **dois itens ativos ao
  mesmo tempo** em `/ai/usage` ("Assistente IA" e "Uso de IA") — o guard antigo
  (`startsWith(href + '/')`) não resolvia isso de verdade. Corrigido com match do segmento mais
  específico (`app-sidebar.tsx`).
- `Button`/`Input`/`Select`/`Card`/`Badge` reescritos sobre os tokens novos, **preservando a API
  de props** de cada um (zero quebra de call site). Primitivos shadcn adicionados via CLI:
  sidebar, sheet, tooltip, dropdown-menu, avatar, skeleton, sonner, tabs, separator.
- Varredura app-wide: todas as páginas que ainda estavam no tema claro (Customers, Tasks, Team,
  AI, AI Usage, login/register/org-list) migradas pros tokens novos. Removidos os hacks de
  override `dark -mx-4 -my-10 bg-ink-950 ...` que Leads/Outreach/Dashboard usavam pra simular
  dark antes de o shell inteiro ser dark.

### 2. Dashboard ✅

- Adicionado o card "Inteligência de IA" (dado real via `useAiUsage` — requests do mês + budget
  bar reaproveitado de `ai/usage`), sem inventar métrica de "tool accuracy" que a API não expõe.
- Componentes locais da página (`KpiCard`, `QualificationRateCard`, `DarkCard`, `StatCardDark`)
  migrados pros tokens semânticos.
- **Bug real encontrado com dados reais em volume** (só apareceu depois de popular a base com
  35 leads — com poucos leads/estados o bug não se manifestava): os gráficos "Leads por status"
  (donut) e "Leads por cidade" (barras) renderizavam completamente em branco de forma
  consistente. Causa: bug conhecido de Recharts + React 18 Strict Mode (double-invoke em dev)
  que trava a animação de entrada dos shapes — os grupos SVG existiam mas ficavam vazios
  (`<g class="recharts-inactive-bar"></g>` sem nenhum `<path>`/`<rect>` dentro).
  **Corrigido** adicionando `isAnimationActive={false}` em `DonutChart`, `BarChartHighlighted` e
  `LineChartWithTooltip` (`apps/web/components/ui/chart-card.tsx`) — o `SparklineChart` já tinha
  isso e por isso nunca falhava. Testado com múltiplos reloads, resolvido de forma consistente.

### 3. Leads (lista + detalhe) ✅

- `leads/page.tsx`: migrado de `fieldClass`/`primaryButtonClass`/`FormErrorDark` locais pros
  componentes compartilhados (`Button`/`Input`/`Select`/`FormError`).
- `leads/[leadId]/page.tsx`: **reestruturado em duas colunas** — painel lateral fixo (sticky)
  "Lead Intelligence" (site/telefone/e-mail/avaliação/endereço/fonte, score com breakdown,
  oferta sugerida, e os botões Pontuar/Enriquecer/Analisar/Converter) ao lado da coluna
  principal (histórico de enriquecimento + outreach). Deliberadamente **não** incluí sinais
  tipo "WhatsApp disponível"/"Instagram ativo"/"maturidade digital" que a inspiração visual
  original sugeria — esses campos não existem no modelo de dado real, e inventar teria sido
  fabricar sinal.

### 4. Aprovações / Outreach ✅

- `outreach/page.tsx`: trocado de tabela pra **lista de cards** (mais alinhado à linguagem
  visual do resto do app), migrado pros componentes compartilhados. Não adicionei nome do
  negócio no card (o endpoint `GET .../outreach-messages` não faz join com `Lead`, só tem
  `leadId` — dar join seria mudança de backend, fora do escopo desta reforma visual) nem
  expandi as ações além de Aprovar/Rejeitar (que é tudo que a fila já expunha — adicionar
  regenerar/marcar-enviada/marcar-respondida aqui seria mudança de produto, não só visual).

### Pendente (ordem sugerida original)

5. **Customers** — ainda só recebeu a varredura de tokens da Fase 1 (sem redesign de layout
   próprio).
6. **Tasks** — idem, só varredura de tokens.
7. **AI Assistant** (`ai/page.tsx`) — idem.
8. **AI Usage** (`ai/usage/page.tsx` + `ai-usage-panel.tsx`) — idem.
9. **Automations / Documents** — não têm página no frontend ainda (só existem no backend);
   ver `CLAUDE.md` sobre esses módulos antes de criar UI nova pra eles.
10. **Team** — só varredura de tokens.

Todas essas têm o "trabalho pesado" (tokens/sidebar/shell) já pronto — o que falta é redesign
de layout específico de cada uma, se fizer sentido (algumas, como Team, já ficam decentes só
com a varredura que já rolou).

## Trabalho de prospecção real (dados reais na org CazaTech)

Depois do redesign, o usuário pediu pra popular a base com **leads reais** (não fake) pra testar
com dado de verdade e, na prática, tentar gerar receita real: meta de **2 clientes / R$3.000 nos
próximos dias**.

### O que existe hoje na org CazaTech (`organizationId: 1c1f4686-45d4-45a8-97ba-731594b6341d`)

- **35 leads reais** (nome, cidade, categoria, endereço/telefone quando encontrado, site quando
  existe — tudo verificado via busca na web, nada inventado), distribuídos:
  - Cidades: Presidente Prudente (15), Santos (15), São Paulo capital (5).
  - Setores: clínicas odontológicas/estéticas, siderurgia/metalurgia, imobiliárias, material
    elétrico, corretoras/exportadoras de café.
  - Todos pontuados via `POST /leads/:id/score` (scoring real do produto, não fake).
  - **22 estão sem site** (`hasNoWebsitePoints` = 50 pts dominando o score → QUALIFIED),
    13 com site → DISQUALIFIED.
- **22 registros de `LeadEnrichment{type:'ai_analysis'}`** gravados manualmente (via SQL) pra
  cada lead sem site, no mesmo formato que a feature real `analyze_lead_potential` geraria —
  necessário porque **não há `ANTHROPIC_API_KEY` configurada** neste ambiente, então a feature
  de IA de verdade não roda. O texto de cada análise é específico por segmento (não genérico
  "sem site → vende site"):
  - **Material elétrico** (5 sem site): catálogo por categoria + "peça pelo WhatsApp" — R$800–1.200, 2–3 dias. Segmento mais fácil de fechar rápido.
  - **Clínicas** (3 sem site: Clínica Vida Odontologia, Essencial Clínica Odontológica, Dra. Rose Marques Estética Dental): agendamento online + WhatsApp Business (+ galeria antes/depois na estética) — R$800–1.500, 2–3 dias.
  - **Imobiliária** (5 sem site): vitrine simples dos imóveis + WhatsApp direto, v1 sem CMS pra reduzir dependência de portal pago (OLX/ZAP) — R$1.200–1.500, 3–4 dias.
  - **Metalurgia** (6 sem site): site institucional + galeria de trabalhos + orçamento — R$1.200–2.000, 3–5 dias (depende de conseguir fotos).
  - **Café/corretoras** (3 sem site): site institucional bilíngue pra credibilidade internacional — R$2.500–4.000, ciclo de 1–2 semanas. **Deliberadamente de baixa prioridade pro prazo de "dias"** — ticket maior mas venda mais lenta.
- **5 `OutreachMessage` em DRAFT** já na fila de Aprovações (canal WhatsApp, prontos pra
  revisar/editar/aprovar), escolhidos por terem telefone confirmado + estarem nos segmentos
  mais rápidos de fechar:
  1. Rauze Imobiliária (Presidente Prudente)
  2. Voltluz Materiais Elétricos (Santos)
  3. PHM Imóveis (Presidente Prudente)
  4. Dra. Rose Marques Estética Dental (Santos)
  5. Eletrosul Eletrorede (Presidente Prudente)

  Status desses 5 leads atualizado pra `OUTREACH_DRAFTED` (consistente com o que o fluxo real
  faria).

### O que foi tentado e NÃO funcionou (documentado pra não repetir)

- **Reddit** ("gente pedindo dev/site"): `WebFetch` bloqueia acesso direto a `reddit.com`;
  `WebSearch` não indexa posts individuais do Reddit de forma confiável (testadas 8 variações
  de query, zero URL real de post retornada). **Zero oportunidade fabricada** — se não achou,
  reportei que não achou.
- **Marketplaces de freelance** (Workana, 99Freelas, GetNinjas): achei 3 pedidos reais e
  específicos via busca, mas **os 3 já estavam fechados/atendidos** (um até com 153 propostas
  recebidas). Causa raiz: busca via Google só indexa histórico de páginas, não a fila de
  "aberto agora" — isso exigiria navegar logado dentro da plataforma, o que não é possível só
  com fetch/busca pública. Workana bloqueou o `WebFetch` direto (403).
- **Conclusão prática**: o canal "inbound reativo" (achar quem já está pedindo um dev agora)
  não é algo que buscas automatizadas resolvem bem — precisa do usuário checando manualmente
  o painel de projetos abertos do Workana/GetNinjas/99Freelas logado (~10 min), ou da
  integração Camofox do próprio produto (`CAMOFOX_GOOGLE_SEARCH`/`CAMOFOX_REDDIT_SEARCH`, que
  usa um browser stealth de verdade, não só fetch — mas precisa de `CAMOFOX_API_URL`
  configurada, que não está).

### Notas de dados de teste

- Existe 1 lead de teste anterior a esse lote, **"Clínica Vida Odontologia"** (São Paulo,
  `sourceType: MANUAL`, score 70, já com outreach aprovado) — criado ainda na fase de QA visual
  do redesign do Lead Intelligence panel. Não tem endpoint de DELETE pra leads na API, então
  ficou na base — é facilmente identificável (é o único com dado de avaliação/rating
  fabricado pra fins de teste visual, 4.7/132 avaliações, diferente de todos os outros 35 que
  só têm dado 100% verificado).
- Nenhuma das 3 fontes de scrape automatizável do produto (Apify, Explorium, Camofox) tem
  API key configurada em `.env` — por isso todo esse lote de 35 leads foi criado via busca
  manual na web + `POST /leads` (`sourceType: MANUAL`), não via `ScrapeJob`.

## Notas operacionais importantes (evitar repetir erro)

- **Nunca rodar `pnpm --filter web run build` com o dev server rodando** — corrompe o cache
  `.next` (erro `Cannot find module './vendor-chunks/...'`). Se acontecer: matar o processo
  `next dev`, `rm -rf apps/web/.next`, subir de novo.
- **Rodar a API/worker sempre via `pnpm dev` na raiz** (usa `dotenv -e .env -- turbo run dev`),
  nunca `pnpm --filter api dev` direto — esse último pula o carregamento do `.env` e a API
  cai com erro de variáveis obrigatórias ausentes.
- `typecheck` e `lint` são seguros de rodar a qualquer momento (não tocam `.next`).
- Banco local: `docker exec -it opsmind-postgres-1 psql -U opsmind -d opsmind` (usuário do
  `DATABASE_URL`, não `postgres`).

## Arquivos alterados nesta sessão (não commitado)

Modificados: `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/app/providers.tsx`,
`apps/web/app/page.tsx`, `apps/web/app/login/page.tsx`, `apps/web/app/register/page.tsx`,
`apps/web/app/organizations/page.tsx`, `apps/web/app/organizations/[organizationId]/layout.tsx`,
`.../dashboard/page.tsx`, `.../leads/page.tsx`, `.../leads/[leadId]/page.tsx`,
`.../outreach/page.tsx`, `.../customers/page.tsx`, `.../customers/[customerId]/page.tsx`,
`.../tasks/page.tsx`, `.../team/page.tsx`, `.../ai/page.tsx`, `.../ai/usage/page.tsx`,
`apps/web/components/app-header.tsx`, `apps/web/components/ai/ai-usage-panel.tsx`,
`apps/web/components/ai/budget-bar.tsx`, `apps/web/components/ui/{badge,button,card,input,select,chart-card}.tsx`,
`apps/web/package.json`.

Deletado: `apps/web/components/app-nav.tsx`.

Novos: `apps/web/components/app-sidebar.tsx`, `apps/web/components/app-topbar.tsx`,
`apps/web/lib/nav-items.ts`, `apps/web/components/ui/{sidebar,sheet,tooltip,dropdown-menu,avatar,skeleton,sonner,tabs,separator}.tsx`,
`apps/web/hooks/use-mobile.ts`.

Nada disso foi commitado ainda — `git status`/`git diff` no início da próxima sessão mostra
exatamente esse estado.

## Como retomar na próxima sessão

1. Rodar `pnpm dev` na raiz (api+worker+web), confirmar `curl localhost:3000/health` e
   `curl localhost:3001/` respondendo 200 antes de mexer em código.
2. Decidir: commitar o que já está pronto (fundação + Dashboard + Leads + Outreach) antes de
   seguir pras próximas páginas? (Ainda não foi pedido commit nesta sessão.)
3. Próxima página sugerida pra redesign: **Customers**, seguindo o mesmo padrão das anteriores
   (migrar pros componentes compartilhados, considerar se o layout merece mudança estrutural
   além da varredura de tokens que já rolou).
4. No lado de prospecção: revisar/aprovar os 5 outreach drafts na fila de Aprovações, e decidir
   se quer que eu busque mais leads (outros setores/cidades) ou tente de novo o ângulo
   Reddit/marketplace de outro jeito.
