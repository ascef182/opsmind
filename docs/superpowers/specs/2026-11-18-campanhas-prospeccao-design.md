# Campanhas de prospecção — design

Status: implementado e aplicado no banco local em 2026-11-18. Conflitos C1–C5 decididos (seção 7: recomendações aprovadas).

## 1. Intenção

Hoje os leads aparecem numa lista única, com cidades, segmentos, buscas e lixo de diretório misturados. A
prospecção passa a ser organizada por **campanha**: uma busca de um segmento numa cidade
("Metalúrgicas — Presidente Prudente/SP"), com página própria, indicadores e mensagens. O objetivo é ver
rápido quais campanhas trazem oportunidades comerciais.

**Não-objetivos:** fusão (merge) automática de empresas duplicadas, nova fonte de busca, mudança nas
regras de envio automático, Fase 2 do Harvey.

**Anti-objetivos:** inventar a campanha de um lead antigo; apagar ou sobrescrever histórico; tratar
diretório, página de contato, notícia ou categoria como empresa qualificada.

## 2. Modelo (decidido)

| Entidade | Papel |
|---|---|
| `SalesCampaign` | A campanha. Identificada por segmento + cidade + estado. Continua guardando as configurações do Harvey (horário, metas, orçamento, canais). |
| `ProspectingTarget` | Busca recorrente dentro da campanha (uma por fonte). Cidade, estado e segmento sempre iguais aos da campanha. |
| `ScrapeJob` | Cada execução de busca. |
| `Lead` | A empresa. Uma linha por organização, como hoje. |
| `CampaignLead` (nova) | Participação de uma empresa numa campanha, com histórico. Muitos-para-muitos. |
| `OutreachMessage.campaignId` (novo) | Campanha em que o rascunho foi gerado. |

### 2.1 `SalesCampaign` — campos novos

- `segment`, `city`, `state`: texto, nulos só nas campanhas especiais (abaixo).
- `kind`: `STANDARD` | `LEGACY`.
- `status` ganha `PAUSED` e `COMPLETED` (hoje: `ACTIVE`, `ARCHIVED`). O Harvey só trabalha em `ACTIVE`, como já faz.
- `completedAt`, `archivedAt`.
- Unicidade: índice único parcial em `(organization_id, lower(segment), lower(city), upper(state))` para
  `kind = 'STANDARD' AND status <> 'ARCHIVED'`. Arquivada não bloqueia recriar.

Campanhas especiais por organização:
- **"Legado — campanha não identificada"** (`kind = LEGACY`, `status = COMPLETED`, sem alvos). Criada só
  se a organização tiver leads antigos sem campanha comprovável. O Harvey nunca trabalha nela.
- **"Campanha padrão"** da Fase 1: perde os alvos (que vão para suas campanhas reais), mantém o histórico de
  ciclos e atividades do Harvey e é arquivada. Nada é apagado.

### 2.2 `CampaignLead`

```
id, organization_id, campaign_id, lead_id,
origin            SEARCH | MANUAL | BACKFILL_EXACT | LEGACY
first_scrape_job_id, last_scrape_job_id (SetNull)
first_found_at, last_found_at, times_found
UNIQUE (campaign_id, lead_id)
```

RLS igual às outras tabelas por organização. Toda ingestão de lead por busca faz upsert aqui
(incrementa `times_found`, atualiza `last_*`) — nunca sobrescreve a participação em outra campanha.

`Lead.campaignId` continua existindo como ponteiro para a **campanha mais recente** (o Harvey usa para
decidir trabalho automático). O histórico fica em `CampaignLead`.

### 2.3 Classificação da qualidade

- `Lead.entityType`: `BUSINESS` | `PROFESSIONAL` | `DIRECTORY` | `INTERNAL_PAGE` | `IRRELEVANT` | `UNKNOWN`.
- `Lead.disqualificationReason`: código (`DIRECTORY_DOMAIN`, `LISTICLE_TITLE`, `INTERNAL_PAGE_PATH`,
  `SCORE_BELOW_THRESHOLD`, `DUPLICATE`, `MANUAL`…) com rótulo em português no web.
- `Lead.duplicateOfLeadId` (nulo, SetNull): só preenchido por confirmação humana.
- Classificador determinístico em `packages/shared-types` (`classifyLeadCandidate`), usado pelo worker na
  ingestão: domínio de diretório conhecido, título de listicle, caminho de página interna (`/contato`,
  `/noticias`, `/blog`, `/categoria`, `/tag`…). Resultado do Google Maps e da Explorium começa como
  `BUSINESS`. Qualquer coisa diferente de `BUSINESS`/`PROFESSIONAL` vira `DISQUALIFIED` com motivo e nunca
  chega a `QUALIFIED`, independentemente do score.
- O filtro atual do Camofox, que descarta diretórios sem registro, passa a gravá-los como desqualificados com
  motivo (aparecem em "Desqualificados" da campanha).
- Leads antigos ficam `UNKNOWN`: nenhuma classificação é inventada na migration.

## 3. Comportamento

- **Criar campanha** (OWNER/ADMIN): nome sugerido "Segmento — Cidade/UF", editável. Cria a campanha e um
  alvo por fonte escolhida. Configurações do Harvey copiadas da campanha ativa mais recente da organização
  (ou do padrão), orçamento mensal da campanha vazio (o teto do engine continua valendo).
- **Nova busca avulsa** (tela de leads, `POST scrape-jobs`): procura a campanha `STANDARD` não arquivada do
  mesmo segmento + cidade + estado; se não existir, cria. Deixa de cair na "Campanha padrão".
- **Pausar / retomar / finalizar / arquivar**: muda `status`. Pausar e finalizar param o trabalho automático
  do Harvey nessa campanha; ações manuais seguem, como na Fase 1. Arquivar esconde da lista padrão.
- **Mensagens**: `generateDraft` grava `campaignId` = campanha do contexto (job do Harvey ou de rascunho
  automático) ou, no pedido manual, `Lead.campaignId`.
- **Contadores por campanha** (calculados no servidor, a partir de `CampaignLead`):
  encontrados, qualificados, desqualificados, pendentes (`DISCOVERED`), mensagens aprovadas, enviadas e
  respondidas (de `OutreachMessage.campaignId`).

## 4. Plano de migration (revisado com os ajustes de 2026-11-18)

Arquivos: `packages/database/prisma/migrations/20261118130000_campaign_prospecting_enums`,
`…130100_campaign_prospecting` (estrutura e RLS), `…130200_campaign_prospecting_backfill` (preenchimento e
verificações) e o rollback manual `packages/database/prisma/rollbacks/20261118130200_campaign_prospecting.down.sql`.

A migration da Fase 1 não é editada (já aplicada; mudar o arquivo exigiria resetar o banco). A M3 desfaz a
atribuição dela a partir de dados comprováveis.

**Ajustes pedidos e como ficaram:**
1. **Conflitos de configuração.** Alvos que caem na mesma campanha mas vêm de campanhas com configuração do
   Harvey diferente **abortam** a migration com a lista dos conflitos. Sem conflito, a configuração da campanha de
   origem é copiada sem alteração e a original fica preservada (arquivada, com todo o histórico). As campanhas
   migradas nascem `PAUSED`: nada automático começa antes da revisão. Conflitos de significado (metas e orçamento
   que eram da organização inteira, fuso e país herdados da Fase 1) estão na seção 7, para decisão.
2. **Mensagens históricas.** Só recebem campanha com evidência registrada (atividade `outreach.draft` do Harvey
   com campanha). As demais ficam `campaign_attribution = UNIDENTIFIED_LEGACY`, sem campanha. Restrição no banco:
   mensagem nova exige `campaign_id`; "não identificada" só é aceita para mensagens criadas antes da migration (data
   fixada na própria restrição).
3. **`CampaignLead`.** Único por (campanha, lead). Primeira ocorrência (`first_found_at`, `first_scrape_job_id`) e
   `origin` nunca são sobrescritas; nova descoberta só atualiza `last_*` e soma `times_found`. CHECKs garantem
   `first_found_at <= last_found_at` e `times_found >= 1`. Apagar uma campanha com participações é bloqueado (FK NO ACTION).
4. **Duplicatas.** Nenhuma fusão. Tabela `lead_duplicate_candidates` (par ordenado, motivos, status
   PENDING/CONFIRMED/DISMISSED, quem revisou). URL normalizada sem protocolo, `www`, fragmento, barras finais e
   parâmetros de rastreamento (`utm_*`, `gclid`, `fbclid`, `msclkid`, `igshid`, `mc_*`, `ref`, `si`); parâmetros que
   identificam a página (ex.: `profile.php?id=`) são mantidos. Telefone: só dígitos, últimos 10–11, mesma cidade.
   Os candidatos são gerados pela aplicação (mesma função da ingestão), não pela migration.
5. **Busca avulsa.** Reutiliza a campanha viva (ativa ou pausada) com a mesma chave segmento + cidade + estado; não
   altera a configuração dela. Se só existir finalizada, responde 409 pedindo para reabrir ou escolher. Sem nenhuma,
   cria com `creation_source = AUTO_FROM_SEARCH`. Campanhas criadas na tela têm `USER`; pela migration, `MIGRATION`.
6. **Segurança e recuperação.** Ver seção 8.

**Ordem da M3:** backup dos valores que mudam em `migration_backup` (sem acesso do `opsmind_app`) → retrato (md5)
das tabelas protegidas → campanhas existentes viram `GENERAL` → alvos agrupados por chave normalizada (checagem de
conflito) → campanhas `STANDARD` → evidência lead → busca → (busca original, se fallback) → alvo por id ou igualdade
exata de cidade/estado/segmento/fonte → participações `BACKFILL_EXACT` → sem prova: `LEGACY`; manuais: campanha
"Cadastro manual" (`MANUAL_ENTRY`) → ponteiro `leads.campaign_id` → buscas → mensagens → arquiva "Campanha padrão" sem
alvos → motivo `SCORE_BELOW_THRESHOLD` só com score gravado abaixo de 50 → restrições → verificação.

**Verificação no fim da M3 (falha desfaz tudo):** md5 e contagem iguais antes/depois em `leads`,
`outreach_messages`, `prospecting_targets`, `scrape_jobs`, campanhas existentes (exceto as colunas que a migration
pode mudar), `harvey_activities`, `harvey_runs`, `pipeline_stage_transitions`, `lead_enrichments`, `lead_signals`,
`deals`, `internal_notes`, `customers`, `cost_events`, `audit_logs`; todo lead com participação; ponteiro do lead
coerente; nenhuma linha cruzando organizações; origem compatível com o tipo da campanha; todo alvo na campanha da
sua própria chave.

## 5. API e web

**API** (`modules/harvey/campaigns.*`, estendido):
- `GET .../campaigns`: lista paginada com contadores, filtros `search`, `city`, `segment`, `status`, `includeArchived`;
  indicadores gerais no topo.
- `GET .../campaigns/:id`, `POST`, `PATCH`, `POST :id/pause|resume|complete|archive`.
- `GET .../campaigns/:id/leads`: paginado no servidor, filtros (qualificação, tipo, status, score, tem site),
  ordenação (score, data de descoberta, nome).
- `GET .../campaigns/:id/outreach-messages?status=`.
- `GET .../campaigns/:id/possible-duplicates`, `POST .../leads/:id/mark-duplicate|unmark-duplicate`.

**Web:**
- `organizations/[id]/campaigns`: tabela compacta com os contadores, indicadores no topo, busca e filtros.
- `organizations/[id]/campaigns/[campaignId]`: cabeçalho com ações, abas "Leads" e "Mensagens".
- O detalhe do lead continua sendo `/leads/[leadId]`, que ganha a lista de campanhas em que a empresa apareceu.
- As telas `/leads`, `/prospecting-targets` e Harvey continuam funcionando. O seletor de campanha do alvo passa a
  listar campanhas reais.

## 6. Fica com o implementador

Rótulos e textos da interface, ordem das colunas, heurísticas exatas do classificador além das listadas,
formato interno dos DTOs.

## 7. Conflitos para decisão (dados reais da CazaTech)

- **C1 Metas e orçamento.** Havia uma configuração só, da organização inteira (30 pesquisas, 15 qualificados e 10
  contatos por dia). Copiada para 17 campanhas, a capacidade diária do Harvey sobe até 17×.
- **C2 Fuso, país e idioma.** A "Campanha padrão" da CazaTech ficou `US` / `en-US` / `America/New_York`, porque a
  organização não tinha configuração de país e a Fase 1 assumiu EUA. Copiado, as campanhas de cidades de SP herdam isso.
- **C3 Grafias.** Normalização junta maiúsculas, acentos e estado por extenso ("Imobiliaria" + "Imobiliária" em
  São Paulo viram uma campanha; "São Paulo" → SP). Não junta plural: "Barbearia — São Paulo/SP" e "Barbearias — São
  Paulo/SP" ficam separadas. O nome vem do alvo mais antigo (ex.: "Imobiliaria — São Paulo/SP", sem acento).
- **C4 Alvos repetidos.** "imobiliária" e "Imobiliária" em Presidente Prudente, ambos Google Maps, ficam na mesma
  campanha (limite 8 / espera 7 dias e limite 30 / espera 1 dia). Os dois são mantidos e o Harvey buscaria duas vezes.
- **C5 Buscas avulsas antigas.** 13 leads vêm de buscas sem alvo cadastrado (Camofox, "clinica odontologica" em Campo
  Belo/MG e Santos/SP). Pela regra pedida ficam no Legado, embora a própria busca registre segmento e cidade.

## 8. Validação feita (cópia `opsmind_sim`, restaurada do backup)

Backup: `pg_dump` em `.local-backups/` (fora do git), restaurado com sucesso em `opsmind_sim`. Migrations aplicadas na
cópia com sucesso; o banco `opsmind` não foi alterado. RLS testada com `opsmind_app`. Rollback aplicado na cópia: as
43 tabelas voltaram idênticas (md5) e o schema idêntico, exceto os valores PAUSED/COMPLETED do enum, que o Postgres não
remove. Reaplicação depois do rollback funcionou.
