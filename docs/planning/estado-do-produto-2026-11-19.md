# OpsMind: estado do produto e próximas decisões (19/11/2026)

Este documento serve para planejar as próximas decisões. Ele reúne:

- o que já existe, página por página;
- o que construímos no OpsGov;
- quais fluxos estão fechados de ponta a ponta;
- o que falta para o OpsMind virar um produto que alguém queira usar todo dia.

Ele foi montado a partir do código (páginas, módulos da API, worker) e dos planos em `docs/`. Itens marcados com
**(verificar)** saíram de uma leitura rápida e merecem uma conferência na tela.

---

## 1. Onde as coisas estão hoje

> **Atualização (19/11, fim do dia):** unificação feita. As campanhas foram commitadas (`aadf314`) e o
> `feat/opsgov` foi mesclado. O `main` (`5063678`) tem tudo, a pasta principal está no `main` e o banco `opsmind`
> já tem as tabelas do OpsGov. O backup está em `.local-backups/opsmind-20261119-175833.dump`. A tabela abaixo
> mostra como estava antes.

O código está espalhado em três lugares, e é por isso que o OpsGov não aparece na sua conta.

| Onde | Branch | Banco | O que tem |
|---|---|---|---|
| Pasta principal `Opsmind/` (o que roda em :3000/:3001) | `feat/harvey-fase1-controle` + ~58 arquivos **não commitados** (campanhas de prospecção) | `opsmind` (sua conta e seus dados) | Tudo, menos o OpsGov |
| `main` (GitHub) | `a1a1cd9`, Harvey Fase 1 | — | Tudo até o Harvey Fase 1, sem campanhas e sem OpsGov |
| Worktree `.worktrees/feat-opsgov` | `feat/opsgov` (Fases 1–5, no GitHub) | `opsmind_opsgov` (banco de teste) | `main` + OpsGov |

**Para ter tudo num lugar só, com seus dados** (a ordem importa):

1. Fechar as campanhas: rodar os testes, commitar o trabalho pendente na pasta principal e mergear em `main`.
2. Fazer rebase do `feat/opsgov` sobre esse `main`. Os dois mexem em `schema.prisma`, `nav-items.ts`, `CLAUDE.md` e
   `packages/database/src/index.ts`, então são conflitos pequenos e esperados.
3. Mergear o `feat/opsgov` em `main` e voltar a trabalhar só na pasta principal.
4. Rodar `prisma migrate deploy` no banco `opsmind`. As migrations do OpsGov só **acrescentam** tabelas e uma coluna
   nullable, então nenhum dado existente é tocado. Em seguida, `pnpm seed:opsgov -- --org <sua-org> --since <data de
   abertura do MEI> --cnpj <cnpj>`.
5. Fazer as Fases 6 e 7 do OpsGov já em cima do banco real.

Antes do passo 4, vale um backup: `pg_dump` do `opsmind` (5 minutos, e o seu receio de perder dados some).

---

## 2. O que existe, página por página

Legenda:

- ✅ fluxo completo e usável;
- 🟡 funciona, mas tem lacuna clara;
- 🔴 só existe na API, ou é esqueleto.

### Acesso e organização

| Página | O que faz | Estado |
|---|---|---|
| `/login`, `/register` | Entrar e criar conta (JWT com refresh) | 🟡 Não tem "esqueci a senha", verificação de e-mail nem "sair de todos os dispositivos" |
| `/organizations` | Lista suas organizações e cria uma nova | 🟡 Não há onboarding depois de criar: a org nasce vazia, sem guia |
| `/team` | Membros, convites, troca de papel (OWNER > ADMIN > MANAGER > MEMBER > VIEWER) e remoção | ✅ |
| Configurações da organização | — | 🔴 Não existe página: nome, logo, fuso, orçamento de IA e dados da empresa ficam espalhados ou só na API |

### Painel

| Página | O que faz | Estado |
|---|---|---|
| `/dashboard` | Clientes e tarefas, pipeline de leads, pipeline de negociação, previsão de fechamento e uso de IA | 🟡 Mostra muitos números, mas não diz **o que fazer hoje**. Falta uma lista de pendências (aprovações, tarefas vencidas, certidões vencendo, follow-ups) |

### Comercial: prospecção (Revenue Engine + Harvey)

| Página | O que faz | Estado |
|---|---|---|
| `/revenue` | Visão geral do engine: funil de 15 estágios, economia e custos | ✅ |
| `/revenue/pipeline` | Funil em tabela, uma linha por estágio, com histórico de transições | ✅ |
| `/revenue/harvey` | Liga, pausa e para o agente SDR por campanha, com atividade em tempo real (SSE) | 🟡 Fase 1 (controle) feita. O Harvey ainda não conversa nem envia sozinho |
| `/revenue/costs` | Gasto diário dos últimos 30 dias e por categoria (IA, scraping, e-mail) | ✅ |
| `/revenue/settings` | Pausa de outreach (nasce pausado), limites diários e orçamento mensal | ✅ |
| `/campaigns`, `/campaigns/[id]` | Campanha = segmento + cidade + estado, com metas, horário, leads, mensagens e revisão de duplicatas | 🟡 Pronta no código, **não commitada** |
| `/prospecting-targets` | Buscas recorrentes dentro de uma campanha (Apify, Explorium, Camofox) | ✅ |
| `/leads` | Resultado das buscas, filtros, disparo de busca em lote e descarte por busca | ✅ |
| `/leads/[id]` | Score com explicação, sinais, enriquecimento, investigação do site, análise de IA, rascunho de outreach, notas, atribuição e conversão em cliente | ✅ É a página mais completa do produto |
| `/outreach` ("Aprovações") | Inbox compartilhada: aprovar, editar e rejeitar rascunhos | 🟡 O envio real depende de domínio verificado. Respostas recebidas ainda não são classificadas (Fase 4 do roadmap) |
| `/market-opportunities` | Oportunidades de mercado detectadas, com mudança de status | 🟡 Não está claro como isso vira ação (lead, campanha). Precisa de um fluxo de saída **(verificar)** |
| `/signal-codes` | Catálogo de sinais (dores) sugeridos pela IA e confirmados por uma pessoa | ✅ |
| `/reddit-watch-topics` | Monitoramento de tópicos no Reddit | 🟡 Funcional, mas é um nicho dentro do produto. Decidir se continua no menu |

### Comercial: venda e relacionamento (CRM)

| Página | O que faz | Estado |
|---|---|---|
| `/customers` | Lista e cadastro de clientes | ✅ |
| `/customers/[id]` | Edição, negócios do cliente, timeline e notas | ✅ |
| `/deals` | Kanban de negócios, com movimentação por estágio | ✅ |
| `/deals/[id]` | Edição, proposta gerada por IA (PDF), assinatura eletrônica (Clicksign), reuniões e notas | 🟡 Não há etapa de aprovação da proposta antes de enviar, nem precificação com margem (Fase 6 do roadmap) |
| `/tasks` | Tarefas com responsável, cliente e prazo; o worker avisa quando vencem | ✅ |
| `/automations` | Regras automáticas (ex.: cliente inativo → tarefa), com execução manual e histórico | ✅ |

### Financeiro (MANAGER ou acima)

| Página | O que faz | Estado |
|---|---|---|
| `/finance` | Receita do mês, caixa e resultado, negócios ganhos sem contrato e conta pessoal | ✅ |
| `/finance/entries` | Lançamentos: criar, emitir, registrar pagamento, estornar e cancelar | ✅ |
| `/finance/recurring` | Lançamentos recorrentes (geração mensal) | ✅ |
| `/finance/contracts` | Contratos por cliente, com status | ✅ |
| `/finance/reports` | Relatório anual e rentabilidade | ✅ |
| Conciliação bancária e importação de extrato/OFX | — | 🔴 Não existe. Hoje tudo é digitado à mão |
| Emissão de nota fiscal | — | 🔴 Não existe. O lançamento "emitido" é só um status |

### Inteligência

| Página | O que faz | Estado |
|---|---|---|
| `/ai` | Chat com o assistente, que usa 22 tools sobre os seus dados (clientes, negócios, tarefas, leads, financeiro, documentos) | ✅ |
| `/ai/usage` | Consumo de IA versus orçamento mensal | ✅ |
| Documentos | Upload de PDF, extração, busca semântica (RAG) | 🔴 **Não há página.** O upload existe na API e é usado pelo chat e pelo OpsGov, mas você não consegue ver nem gerenciar seus documentos |
| Log de auditoria | Tudo é gravado (`AuditLog`) | 🔴 Não há tela para consultar |
| Notificações | Sino no topo (tarefas, gastos, obrigações e certidões do OpsGov) | 🟡 Não há página de histórico nem preferências (o que avisar, por e-mail ou não) |

---

## 3. O que construímos agora: OpsGov (branch `feat/opsgov`)

O OpsGov é o espaço "empresa e conformidade" da CazaTech (MEI hoje, ME em jan/2027) e a preparação para disputar
licitações. Regras em todo o módulo:

- **Nada se apaga.** Toda mudança de cadastro, regime ou atividade fecha o período vigente e abre um novo, com data
  de vigência, responsável e comprovante em PDF.
- **A IA só lê.** Nenhuma tool muda regime, marca certidão como válida ou envia proposta.

| Página | O que faz | Fase | Estado |
|---|---|---|---|
| `/opsgov/empresa` | Perfil (razão social, CNPJ com dígito verificador, endereço, IM/IE). Linhas do tempo de cadastro (MEI→ME, troca de CNPJ), regime (SIMEI→Simples, IBS/CBS) e CNAEs (principal, anexo, grupo de receita). Cada mudança aceita data e comprovante | 1 | ✅ |
| `/opsgov/receita` (MANAGER+) | Classifica as receitas do Financeiro por CNAE (em lote), mostra a matriz atividade × mês e calcula o RBT12 com a regra de início de atividade | 2 | ✅ |
| `/opsgov/simulador` | Compara Anexo III e Anexo V, calcula o Fator R, o pró-labore mínimo para 28% e a economia. Três cenários editáveis mais um com o RBT12 real. Aviso fixo "Estimativa, não é parecer contábil" | 3 | ✅ |
| `/opsgov/obrigacoes` | Obrigações (DAS, DASN, DEFIS, taxas…) com vencimento e recorrência, cumprimento com guia ou recibo e dispensa com motivo. Certidões com validade e status calculado (válida, vencendo, vencida). O worker avisa em D-7/D-1 (obrigações) e D-15/D-0 (certidões), sem repetir | 4 | ✅ |
| `/opsgov/contador` | Propostas de escritórios (cenário A ou B, custos, PDF) com comparativo de 1º ano e 2º ano em diante, somando os tributos do simulador. Quadro com as 13 decisões pendentes, respostas com histórico, decisão final e reabertura | 5 | ✅ |
| `/opsgov` (Prontidão geral) e `/opsgov/licitacoes` | Atestados técnicos, oportunidades de licitação (RADAR→ANÁLISE→PROPOSTA→DISPUTA→GANHA/PERDIDA), checklist do edital, score de prontidão com bloqueadores e conversão GANHA→cliente+contrato | 6 | ⏳ A fazer |
| Assistente IA | Tools de leitura: status de conformidade, simulação, prontidão e resumo de exigências do edital (só sugere; a confirmação é humana). Eval com prompt injection dentro de edital | 7 | ⏳ A fazer |

Qualidade: lint, typecheck, 841 testes na API, 235 no worker e 233 em shared-types. E2e de isolamento entre
organizações em todas as fases.

---

## 4. Fluxos ponta a ponta

Um produto "digno de uso" é um conjunto de fluxos que começam e terminam sem a pessoa precisar saber como o sistema
funciona por dentro. Status de cada um:

### F1. Prospectar → contatar → vender (o coração comercial)
`Campanha → Busca → Lead qualificado → Rascunho → Aprovação → Envio → Resposta → Negócio → Proposta → Assinatura → Cliente + Contrato → Lançamentos`

- ✅ Campanha até rascunho aprovado.
- 🔴 Envio real: falta domínio de envio, deploy público (webhooks) e descadastro (unsubscribe).
- 🔴 Resposta: não é guardada, nem classificada, nem gera tarefa ou próximo passo.
- 🟡 Negócio→proposta→assinatura funciona, mas sem aprovação de proposta nem preço com margem.
- 🟡 Ganho→contrato: o Financeiro mostra "negócios ganhos sem contrato", mas criar o contrato é manual.

### F2. Relacionamento com o cliente
`Cliente → Negócios → Tarefas/Reuniões → Notas → Automação de inatividade`
- ✅ Completo para uso interno.
- Falta: e-mails trocados com o cliente aparecerem na timeline.

### F3. Dinheiro da empresa
`Contrato → Recorrência → Lançamento → Pagamento → Relatórios → (OpsGov) Receita por CNAE → RBT12 → Simulador → DAS`
- ✅ Do contrato ao relatório, e do RBT12 ao simulador (no branch OpsGov).
- 🔴 Entrada de dados: tudo é manual, sem importação de extrato.
- 🔴 Saída fiscal: não há nota fiscal nem guia do DAS.
- 🟡 Classificar receita por CNAE é um passo manual separado. Poderia ser sugerido já no lançamento, pelo contrato.

### F4. Empresa em dia (OpsGov)
`Perfil → Regime/CNAEs → Obrigações e certidões → Lembretes → Comprovantes`
- ✅ Completo, falta só estar no seu banco.
- 🟡 Não há visão "o que vence nos próximos 30 dias" no Dashboard principal.

### F5. Licitação (OpsGov Fases 6–7)
`Oportunidade → Edital (PDF) → Exigências (IA sugere, pessoa confirma) → Prontidão → Proposta → Disputa → Ganha → Cliente + Contrato`
- ⏳ Por fazer.

### F6. Começar a usar (onboarding)
`Criar conta → Criar organização → Dados da empresa → Convidar equipe → Primeira campanha / primeiro cliente`
- 🔴 Não existe como fluxo. Depois de criar a org, a pessoa cai num dashboard vazio.

---

## 5. O que falta para virar produto

Agrupado por prioridade, do que bloqueia o uso real ao que é refinamento.

### P0: bloqueia o uso real (mesmo só pela CazaTech)

1. **Unificar o código e o banco** (seção 1). Sem isso, cada teste é feito num lugar diferente.
2. **Deploy** (API, worker, web, Postgres com pgvector, Redis) com backup automático do banco. Os Dockerfiles ainda
   omitem `packages/integrations` (anotado no roadmap). Sem URL pública não há webhooks (Resend, Clicksign) nem
   descadastro.
3. **Conta segura**: "esqueci a senha", verificação de e-mail e sair de todas as sessões (PRD-v2 §2.1).
4. **Domínio de envio verificado** (SPF/DKIM/DMARC) e descadastro, antes de qualquer e-mail real.

### P1: fecha os fluxos principais

5. **Respostas de outreach** (Roadmap Fase 4): guardar, classificar, gerar próximo passo e tratar opt-out
   automaticamente.
6. **Ganhou → contrato** em um clique, partindo do negócio (o mesmo padrão do OpsGov GANHA→cliente+contrato).
7. **Página de Documentos**: listar, baixar e ver onde cada documento é usado (comprovantes, propostas, editais).
8. **Dashboard "Hoje"**: aprovações pendentes, tarefas vencidas, follow-ups, obrigações e certidões vencendo, e
   negócios parados.
9. **Configurações da organização**: dados da empresa (reaproveitar o perfil do OpsGov), fuso, orçamentos e
   preferências de notificação.
10. **OpsGov Fases 6 e 7** (licitações e IA de leitura).

### P2: tira atrito do dia a dia

11. Importar extrato bancário (OFX/CSV) e conciliar com os lançamentos.
12. Onboarding guiado para uma organização nova.
13. Tela de auditoria (quem mudou o quê), útil para você e para o contador.
14. Reorganizar o menu: são 17 itens hoje, mais o OpsGov. Uma proposta está na seção 6.
15. Aprovação de proposta comercial e preço com margem (Roadmap Fase 6).

### P3: crescimento (só se o OpsMind for vendido para outras empresas)

16. Cobrança e planos (Stripe), limites por plano e página pública.
17. MFA, SSO, LGPD (exportar e apagar dados de uma organização), termos de uso.
18. Outros canais (WhatsApp/SMS com consentimento) e preview de site (Roadmap Fases 5 e 7).

---

## 6. Proposta de menu (para discutir)

Hoje o menu lista as funcionalidades na ordem em que foram construídas. Uma organização por **trabalho a fazer**:

- **Hoje** (dashboard de pendências)
- **Vender**: Campanhas · Leads · Aprovações · Negócios · Clientes
- **Operar**: Tarefas · Automações · Documentos
- **Dinheiro**: Financeiro · Receita por atividade (OpsGov)
- **Empresa**: Perfil e regime · Obrigações e certidões · Contador · Licitações
- **Inteligência**: Assistente · Revenue Engine (funil, Harvey, custos) · Sinais · Oportunidades de mercado · Reddit
- **Configurações**: Organização · Equipe · Uso de IA · Auditoria

---

## 7. Decisões que dependem de você

1. **O OpsMind é só da CazaTech ou vai virar produto vendido?** Isso define se o P3 entra no plano e quanto investir
   em onboarding e multiempresa.
2. **Ordem: unificar primeiro?** A recomendação é unificar antes de continuar o OpsGov (Fase 6), para testar com os
   seus dados.
3. **Deploy:** onde hospedar (Railway, Fly, VPS) e quando. É pré-requisito do envio real.
4. **Domínio de envio:** qual domínio, e se o outreach para leads dos EUA continua sendo a prioridade comercial.
5. **Itens de nicho no menu:** Reddit e "Oportunidades de mercado" ficam visíveis, saem do menu ou vão para
   "Inteligência"?
6. **Nota fiscal e extrato:** vale integrar (ex.: emissor de NFS-e, Open Finance) ou o contador resolve fora do
   sistema?
7. **Menu novo (seção 6):** aprova a estrutura, ou prefere manter a atual por enquanto?
