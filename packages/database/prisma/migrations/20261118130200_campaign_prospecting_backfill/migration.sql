-- Preenchimento das campanhas de prospecção. Roda numa transação só: se
-- qualquer verificação do fim falhar, nada desta migration fica gravado.
--
-- Regras (docs/superpowers/specs/2026-11-18-campanhas-prospeccao-design.md, seção 4):
--  * alvos com o mesmo segmento + cidade + estado viram uma campanha STANDARD;
--    alvos de campanhas com configuração do Harvey diferente abortam a migration;
--  * desfaz a atribuição de todos os leads à "Campanha padrão" feita pela Fase 1;
--  * lead só ganha campanha com caminho exato lead → busca → alvo → campanha;
--    sem prova vai para "Legado — campanha não identificada";
--  * mensagens antigas só ganham campanha com evidência registrada;
--  * nenhuma linha de histórico (mensagens, atividades, transições, etc.) muda.
--
-- Valores anteriores ficam no schema `migration_backup` (sem acesso do
-- opsmind_app) para o rollback em prisma/rollbacks/20261118130200_campaign_prospecting_backfill.down.sql.

-- ── Funções auxiliares (somem no fim da sessão) ─────────────────────────────

CREATE TEMP TABLE cm_state_names (name TEXT PRIMARY KEY, code TEXT NOT NULL, prio INT NOT NULL) ON COMMIT DROP;
INSERT INTO cm_state_names (name, code, prio) VALUES
  ('acre','AC',1),
  ('alagoas','AL',1),
  ('amapa','AP',1),
  ('amazonas','AM',1),
  ('bahia','BA',1),
  ('ceara','CE',1),
  ('distrito federal','DF',1),
  ('federal district','DF',1),
  ('espirito santo','ES',1),
  ('goias','GO',1),
  ('maranhao','MA',1),
  ('mato grosso','MT',1),
  ('mato grosso do sul','MS',1),
  ('minas gerais','MG',1),
  ('para','PA',1),
  ('paraiba','PB',1),
  ('parana','PR',1),
  ('pernambuco','PE',1),
  ('piaui','PI',1),
  ('rio de janeiro','RJ',1),
  ('rio grande do norte','RN',1),
  ('rio grande do sul','RS',1),
  ('rondonia','RO',1),
  ('roraima','RR',1),
  ('santa catarina','SC',1),
  ('sao paulo','SP',1),
  ('sergipe','SE',1),
  ('tocantins','TO',1),
  ('alabama','AL',2),
  ('alaska','AK',2),
  ('arizona','AZ',2),
  ('arkansas','AR',2),
  ('california','CA',2),
  ('colorado','CO',2),
  ('connecticut','CT',2),
  ('delaware','DE',2),
  ('district of columbia','DC',2),
  ('florida','FL',2),
  ('georgia','GA',2),
  ('hawaii','HI',2),
  ('idaho','ID',2),
  ('illinois','IL',2),
  ('indiana','IN',2),
  ('iowa','IA',2),
  ('kansas','KS',2),
  ('kentucky','KY',2),
  ('louisiana','LA',2),
  ('maine','ME',2),
  ('maryland','MD',2),
  ('massachusetts','MA',2),
  ('michigan','MI',2),
  ('minnesota','MN',2),
  ('mississippi','MS',2),
  ('missouri','MO',2),
  ('montana','MT',2),
  ('nebraska','NE',2),
  ('nevada','NV',2),
  ('new hampshire','NH',2),
  ('new jersey','NJ',2),
  ('new mexico','NM',2),
  ('new york','NY',2),
  ('north carolina','NC',2),
  ('north dakota','ND',2),
  ('ohio','OH',2),
  ('oklahoma','OK',2),
  ('oregon','OR',2),
  ('pennsylvania','PA',2),
  ('rhode island','RI',2),
  ('south carolina','SC',2),
  ('south dakota','SD',2),
  ('tennessee','TN',2),
  ('texas','TX',2),
  ('utah','UT',2),
  ('vermont','VT',2),
  ('virginia','VA',2),
  ('washington','WA',2),
  ('west virginia','WV',2),
  ('wisconsin','WI',2),
  ('wyoming','WY',2)
ON CONFLICT (name) DO NOTHING;

-- Mesma normalização de `campaignIdentityKey` (packages/shared-types/src/campaign-identity.ts).
CREATE FUNCTION pg_temp.cm_fold(v TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
    translate(lower(coalesce(v, '')), 'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ', 'aaaaaaeeeeiiiiooooouuuucnyy'),
    '\s+', ' ', 'g'))
$$;

-- Mesma regra de `normalizeRegionCode` (packages/shared-types/src/region-codes.ts), Brasil antes dos EUA.
CREATE FUNCTION pg_temp.cm_uf(v TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN btrim(coalesce(v, '')) ~ '^[A-Za-z]{2}$' THEN upper(btrim(v))
    ELSE coalesce(
      (SELECT s.code FROM cm_state_names s
        WHERE s.name = regexp_replace(pg_temp.cm_fold(v), '^(state of|estado de|estado do|estado da)\s+', '')
        ORDER BY s.prio LIMIT 1),
      btrim(v))
  END
$$;

CREATE FUNCTION pg_temp.cm_identity(segment TEXT, city TEXT, state TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT pg_temp.cm_fold(segment) || '|' || pg_temp.cm_fold(city) || '|' || pg_temp.cm_fold(pg_temp.cm_uf(state))
$$;

-- Digest de uma tabela (sem as colunas que esta migration pode mudar).
CREATE FUNCTION pg_temp.cm_digest(tbl TEXT, excl TEXT[], filter TEXT) RETURNS TABLE (digest TEXT, n BIGINT) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT md5(coalesce(string_agg((to_jsonb(t) - $1)::text, E''\n'' ORDER BY t.id), '''')), count(*) FROM %I t WHERE %s',
    tbl, filter) USING excl;
END
$$;

-- ── Backup dos valores que mudam ────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS migration_backup;
REVOKE ALL ON SCHEMA migration_backup FROM PUBLIC;

CREATE TABLE migration_backup.cm_leads AS SELECT id, campaign_id FROM leads;
CREATE TABLE migration_backup.cm_scrape_jobs AS SELECT id, campaign_id, prospecting_target_id FROM scrape_jobs;
CREATE TABLE migration_backup.cm_targets AS SELECT id, campaign_id, is_active FROM prospecting_targets;
CREATE TABLE migration_backup.cm_campaigns AS SELECT id, status::TEXT AS status, archived_at FROM sales_campaigns;
CREATE TABLE migration_backup.cm_created_campaigns (id TEXT PRIMARY KEY);

-- ── Retrato do que não pode mudar ───────────────────────────────────────────

CREATE TEMP TABLE cm_protected (tbl TEXT PRIMARY KEY, excl TEXT[] NOT NULL, filter TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO cm_protected VALUES
  ('leads', ARRAY['campaign_id', 'entity_type', 'disqualification_reason', 'duplicate_of_lead_id'], 'true'),
  ('outreach_messages', ARRAY['campaign_id', 'campaign_attribution'], 'true'),
  ('prospecting_targets', ARRAY['campaign_id', 'is_active'], 'true'),
  ('scrape_jobs', ARRAY['campaign_id', 'prospecting_target_id'], 'true'),
  ('sales_campaigns', ARRAY['status', 'kind', 'creation_source', 'archived_at'], 'id IN (SELECT id FROM migration_backup.cm_campaigns)'),
  ('harvey_activities', ARRAY[]::TEXT[], 'true'),
  ('harvey_runs', ARRAY[]::TEXT[], 'true'),
  ('pipeline_stage_transitions', ARRAY[]::TEXT[], 'true'),
  ('lead_enrichments', ARRAY[]::TEXT[], 'true'),
  ('lead_signals', ARRAY[]::TEXT[], 'true'),
  ('deals', ARRAY[]::TEXT[], 'true'),
  ('internal_notes', ARRAY[]::TEXT[], 'true'),
  ('customers', ARRAY[]::TEXT[], 'true'),
  ('cost_events', ARRAY[]::TEXT[], 'true'),
  ('audit_logs', ARRAY[]::TEXT[], 'true');

CREATE TEMP TABLE cm_snapshot ON COMMIT DROP AS
SELECT p.tbl, d.digest, d.n FROM cm_protected p CROSS JOIN LATERAL pg_temp.cm_digest(p.tbl, p.excl, p.filter) d;

-- ── 1. Campanhas existentes são "gerais" (sem segmento/cidade) ──────────────

UPDATE sales_campaigns SET kind = 'GENERAL';
UPDATE sales_campaigns SET creation_source = 'MIGRATION' WHERE name = 'Campanha padrão';

-- ── 2. Alvos → campanhas por segmento + cidade + estado ─────────────────────

CREATE TEMP TABLE cm_target ON COMMIT DROP AS
SELECT t.id, t.organization_id, t.campaign_id AS src_campaign_id, t.business_type, t.city, t.state,
       t.created_at, t.is_active,
       pg_temp.cm_identity(t.business_type, t.city, t.state) AS identity_key,
       pg_temp.cm_uf(t.state) AS uf
FROM prospecting_targets t;

-- Alvos que caem na mesma campanha mas vêm de campanhas com configuração do
-- Harvey diferente: não há como escolher uma sem descartar a outra. Aborta.
DO $$
DECLARE
  r RECORD;
  msg TEXT := '';
BEGIN
  FOR r IN
    SELECT ct.organization_id, ct.identity_key, string_agg(DISTINCT c.name, ', ') AS campaigns
    FROM cm_target ct
    JOIN sales_campaigns c ON c.id = ct.src_campaign_id
    GROUP BY ct.organization_id, ct.identity_key
    HAVING count(DISTINCT row(c.country, c.region_label, c.language, c.timezone, c.working_days,
                              c.work_start_minute, c.work_end_minute, c.daily_research_goal,
                              c.daily_qualified_goal, c.daily_outreach_goal, c.enabled_channels,
                              c.monthly_budget_usd, c.require_first_contact_approval)::TEXT) > 1
  LOOP
    msg := msg || format(E'\n  organização %s, campanha "%s": alvos vindos de %s', r.organization_id, r.identity_key, r.campaigns);
  END LOOP;
  IF msg <> '' THEN
    RAISE EXCEPTION 'Configurações do Harvey em conflito entre alvos da mesma campanha:%', msg;
  END IF;
END
$$;

CREATE TEMP TABLE cm_group ON COMMIT DROP AS
SELECT DISTINCT ON (organization_id, identity_key)
       organization_id, identity_key, btrim(business_type) AS segment, btrim(city) AS city, uf AS state,
       src_campaign_id, gen_random_uuid()::TEXT AS new_id
FROM cm_target
ORDER BY organization_id, identity_key, created_at, id;

-- Configuração copiada sem alteração da campanha de onde os alvos vieram.
-- Nascem PAUSED: nenhum trabalho automático novo começa até alguém revisar.
DO $$
DECLARE
  g RECORD;
  base TEXT;
  candidate TEXT;
  i INT;
BEGIN
  FOR g IN SELECT * FROM cm_group ORDER BY organization_id, segment, city LOOP
    base := g.segment || ' — ' || g.city || '/' || g.state;
    candidate := base;
    i := 1;
    WHILE EXISTS (SELECT 1 FROM sales_campaigns WHERE organization_id = g.organization_id AND name = candidate) LOOP
      i := i + 1;
      candidate := base || ' (' || i || ')';
    END LOOP;

    INSERT INTO sales_campaigns (
      id, organization_id, name, status, country, region_label, language, timezone, working_days,
      work_start_minute, work_end_minute, daily_research_goal, daily_qualified_goal, daily_outreach_goal,
      enabled_channels, monthly_budget_usd, require_first_contact_approval,
      kind, creation_source, segment, city, state, identity_key, created_at, updated_at)
    SELECT g.new_id, g.organization_id, candidate, 'PAUSED', c.country, c.region_label, c.language, c.timezone,
           c.working_days, c.work_start_minute, c.work_end_minute, c.daily_research_goal, c.daily_qualified_goal,
           c.daily_outreach_goal, c.enabled_channels, c.monthly_budget_usd, c.require_first_contact_approval,
           'STANDARD', 'MIGRATION', g.segment, g.city, g.state, g.identity_key, now(), now()
    FROM sales_campaigns c WHERE c.id = g.src_campaign_id;

    INSERT INTO migration_backup.cm_created_campaigns (id) VALUES (g.new_id);
  END LOOP;
END
$$;

UPDATE prospecting_targets t SET campaign_id = g.new_id
FROM cm_target ct
JOIN cm_group g ON g.organization_id = ct.organization_id AND g.identity_key = ct.identity_key
WHERE ct.id = t.id;

-- Decisão C2 (2026-11-18): a "Campanha padrão" da Fase 1 assumiu EUA quando a
-- organização não tinha país configurado. Campanha migrada cujo estado é uma
-- sigla brasileira passa a Brasil / pt-BR / America/Sao_Paulo.
UPDATE sales_campaigns c
SET country = 'BR', language = 'pt-BR', timezone = 'America/Sao_Paulo'
FROM cm_group g
WHERE c.id = g.new_id AND c.country <> 'BR'
  AND g.state IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
                  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO');

-- Decisão C4 (2026-11-18): dois alvos ativos da mesma fonte na mesma campanha
-- fariam o Harvey buscar duas vezes por ciclo. Fica ativo o de maior limite
-- (empate: o mais antigo); os outros são desativados, nunca apagados.
UPDATE prospecting_targets t SET is_active = false
FROM (
  SELECT id, row_number() OVER (PARTITION BY campaign_id, source_type ORDER BY "limit" DESC, created_at, id) AS rn
  FROM prospecting_targets WHERE is_active
) r
WHERE r.id = t.id AND r.rn > 1;

-- ── 3. Origem comprovável de cada busca e de cada lead ──────────────────────

-- Busca → alvo: pelo id gravado (buscas do Harvey) ou pela igualdade exata de
-- cidade, estado, segmento e fonte com um alvo. Fallback conta pela busca original.
CREATE TEMP TABLE cm_job_target ON COMMIT DROP AS
SELECT j.id AS job_id, j.organization_id, coalesce(j.started_at, j.created_at) AS found_at,
       coalesce(
         (SELECT t.id FROM prospecting_targets t WHERE t.id = o.prospecting_target_id AND t.organization_id = o.organization_id),
         (SELECT min(t.id) FROM prospecting_targets t
           WHERE t.organization_id = o.organization_id AND t.city = o.city AND t.state = o.state
             AND t.business_type = o.business_type AND t.source_type = o.source_type
          HAVING count(*) = 1)
       ) AS target_id
FROM scrape_jobs j
JOIN scrape_jobs o ON o.id = coalesce(j.fallback_of_scrape_job_id, j.id);

CREATE TEMP TABLE cm_evidence ON COMMIT DROP AS
SELECT l.id AS lead_id, l.organization_id, t.campaign_id, jt.job_id, jt.found_at
FROM leads l
JOIN cm_job_target jt ON jt.job_id = l.scrape_job_id
JOIN prospecting_targets t ON t.id = jt.target_id AND t.organization_id = l.organization_id
UNION
SELECT l.id, l.organization_id, t.campaign_id, jt.job_id, jt.found_at
FROM harvey_activities a
JOIN leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
JOIN cm_job_target jt ON jt.job_id = a.scrape_job_id
JOIN prospecting_targets t ON t.id = jt.target_id AND t.organization_id = a.organization_id
WHERE a.type = 'research.lead_found';

INSERT INTO campaign_leads (id, organization_id, campaign_id, lead_id, origin, first_scrape_job_id, last_scrape_job_id,
                            first_found_at, last_found_at, times_found, created_at, updated_at)
SELECT gen_random_uuid()::TEXT, organization_id, campaign_id, lead_id, 'BACKFILL_EXACT',
       (array_agg(job_id ORDER BY found_at, job_id))[1],
       (array_agg(job_id ORDER BY found_at DESC, job_id DESC))[1],
       min(found_at), max(found_at), count(DISTINCT job_id), now(), now()
FROM cm_evidence
GROUP BY organization_id, campaign_id, lead_id;

-- ── 4. Sem prova: Legado. Cadastro manual: campanha própria ─────────────────

CREATE TEMP TABLE cm_special ON COMMIT DROP AS
SELECT o.id AS organization_id, k.kind, gen_random_uuid()::TEXT AS new_id
FROM organizations o
CROSS JOIN (VALUES ('LEGACY'), ('MANUAL_ENTRY')) AS k(kind)
WHERE (k.kind = 'LEGACY' AND EXISTS (
        SELECT 1 FROM leads l WHERE l.organization_id = o.id AND l.source_type <> 'MANUAL'
          AND NOT EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.lead_id = l.id)))
   OR (k.kind = 'MANUAL_ENTRY' AND EXISTS (
        SELECT 1 FROM leads l WHERE l.organization_id = o.id AND l.source_type = 'MANUAL'));

-- Fuso, idioma e país vêm da campanha geral mais antiga da organização (só
-- são obrigatórios na tabela; nenhuma das duas roda busca).
INSERT INTO sales_campaigns (id, organization_id, name, status, completed_at, country, region_label, language, timezone,
                             working_days, work_start_minute, work_end_minute, daily_research_goal, daily_qualified_goal,
                             daily_outreach_goal, enabled_channels, monthly_budget_usd, require_first_contact_approval,
                             kind, creation_source, created_at, updated_at)
SELECT s.new_id, s.organization_id,
       CASE s.kind WHEN 'LEGACY' THEN 'Legado — campanha não identificada' ELSE 'Cadastro manual' END,
       CASE s.kind WHEN 'LEGACY' THEN 'COMPLETED' ELSE 'ACTIVE' END::"CampaignStatus",
       CASE s.kind WHEN 'LEGACY' THEN now() END,
       coalesce(c.country, 'BR'), c.region_label, coalesce(c.language, 'pt-BR'), coalesce(c.timezone, 'America/Sao_Paulo'),
       coalesce(c.working_days, ARRAY[1,2,3,4,5]), coalesce(c.work_start_minute, 540), coalesce(c.work_end_minute, 1080),
       0, 0, 0, coalesce(c.enabled_channels, ARRAY['EMAIL']::"OutreachChannel"[]), NULL,
       coalesce(c.require_first_contact_approval, true),
       s.kind::"CampaignKind", 'MIGRATION', now(), now()
FROM cm_special s
LEFT JOIN LATERAL (
  SELECT * FROM sales_campaigns g WHERE g.organization_id = s.organization_id AND g.kind = 'GENERAL'
  ORDER BY g.created_at, g.id LIMIT 1
) c ON true;

INSERT INTO migration_backup.cm_created_campaigns (id) SELECT new_id FROM cm_special;

INSERT INTO campaign_leads (id, organization_id, campaign_id, lead_id, origin, first_scrape_job_id, last_scrape_job_id,
                            first_found_at, last_found_at, times_found, created_at, updated_at)
SELECT gen_random_uuid()::TEXT, l.organization_id, s.new_id, l.id,
       CASE s.kind WHEN 'LEGACY' THEN 'LEGACY' ELSE 'MANUAL' END::"CampaignLeadOrigin",
       NULL, NULL, l.discovered_at, l.discovered_at, 1, now(), now()
FROM leads l
JOIN cm_special s ON s.organization_id = l.organization_id
WHERE (s.kind = 'LEGACY' AND l.source_type <> 'MANUAL' AND NOT EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.lead_id = l.id))
   OR (s.kind = 'MANUAL_ENTRY' AND l.source_type = 'MANUAL');

-- Ponteiro "campanha mais recente" do lead.
UPDATE leads l SET campaign_id = x.campaign_id
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, campaign_id
  FROM campaign_leads
  ORDER BY lead_id, last_found_at DESC, (origin = 'BACKFILL_EXACT') DESC, campaign_id
) x
WHERE x.lead_id = l.id;

-- ── 5. Buscas ───────────────────────────────────────────────────────────────

UPDATE scrape_jobs j
SET campaign_id = t.campaign_id,
    prospecting_target_id = coalesce(j.prospecting_target_id, CASE WHEN j.fallback_of_scrape_job_id IS NULL THEN t.id END)
FROM cm_job_target jt
LEFT JOIN prospecting_targets t ON t.id = jt.target_id
WHERE jt.job_id = j.id;

-- ── 6. Mensagens: só com evidência registrada ───────────────────────────────

UPDATE outreach_messages SET campaign_attribution = 'UNIDENTIFIED_LEGACY';

UPDATE outreach_messages m
SET campaign_id = e.campaign_id, campaign_attribution = 'DRAFT_CONTEXT'
FROM (
  SELECT outreach_message_id, min(campaign_id) AS campaign_id
  FROM harvey_activities
  WHERE type = 'outreach.draft' AND outreach_message_id IS NOT NULL AND campaign_id IS NOT NULL
  GROUP BY outreach_message_id
  HAVING count(DISTINCT campaign_id) = 1
) e
WHERE e.outreach_message_id = m.id;

-- ── 7. Campanha padrão sem alvos é arquivada (histórico do Harvey fica) ─────

UPDATE sales_campaigns c SET status = 'ARCHIVED', archived_at = now()
WHERE c.kind = 'GENERAL' AND c.status <> 'ARCHIVED'
  AND NOT EXISTS (SELECT 1 FROM prospecting_targets t WHERE t.campaign_id = c.id);

-- ── 8. Motivo de desqualificação só quando é fato verificável ───────────────

UPDATE leads SET disqualification_reason = 'SCORE_BELOW_THRESHOLD'
WHERE status = 'DISQUALIFIED' AND score IS NOT NULL AND score < 50;

-- ── 9. Restrições que passam a valer ────────────────────────────────────────

ALTER TABLE sales_campaigns ADD CONSTRAINT sales_campaigns_standard_identity_check
  CHECK (kind <> 'STANDARD' OR (segment IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL AND identity_key IS NOT NULL));

-- Mensagem nova sempre tem campanha; "não identificada" só existe para as
-- mensagens criadas antes desta migration (data fixada na própria restrição).
DO $$
BEGIN
  EXECUTE format(
    'ALTER TABLE outreach_messages ADD CONSTRAINT outreach_messages_campaign_required_check CHECK ('
    'campaign_id IS NOT NULL OR (campaign_attribution = ''UNIDENTIFIED_LEGACY'' AND created_at < %L::timestamp))',
    (now() AT TIME ZONE 'UTC')::TIMESTAMP);
END
$$;

-- ── 10. Verificação: qualquer falha desfaz a migration inteira ──────────────

DO $$
DECLARE
  r RECORD;
  bad BIGINT;
  failures TEXT := '';
BEGIN
  FOR r IN
    SELECT s.tbl, s.digest AS before_digest, s.n AS before_n, d.digest AS after_digest, d.n AS after_n
    FROM cm_snapshot s
    JOIN cm_protected p ON p.tbl = s.tbl
    CROSS JOIN LATERAL pg_temp.cm_digest(p.tbl, p.excl, p.filter) d
  LOOP
    IF r.before_n <> r.after_n OR r.before_digest <> r.after_digest THEN
      failures := failures || format(E'\n  %s mudou (linhas %s → %s)', r.tbl, r.before_n, r.after_n);
    END IF;
  END LOOP;

  SELECT count(*) INTO bad FROM leads l WHERE NOT EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.lead_id = l.id);
  IF bad > 0 THEN failures := failures || format(E'\n  %s lead(s) sem participação em campanha', bad); END IF;

  SELECT count(*) INTO bad FROM leads l
  WHERE l.campaign_id IS NULL OR NOT EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.lead_id = l.id AND cl.campaign_id = l.campaign_id);
  IF bad > 0 THEN failures := failures || format(E'\n  %s lead(s) apontando para campanha sem participação', bad); END IF;

  SELECT count(*) INTO bad FROM campaign_leads cl
  JOIN leads l ON l.id = cl.lead_id JOIN sales_campaigns c ON c.id = cl.campaign_id
  WHERE cl.organization_id <> l.organization_id OR cl.organization_id <> c.organization_id;
  IF bad > 0 THEN failures := failures || format(E'\n  %s participação(ões) cruzando organizações', bad); END IF;

  SELECT count(*) INTO bad FROM campaign_leads cl JOIN sales_campaigns c ON c.id = cl.campaign_id
  WHERE (cl.origin = 'BACKFILL_EXACT' AND c.kind <> 'STANDARD')
     OR (cl.origin = 'LEGACY' AND c.kind <> 'LEGACY')
     OR (cl.origin = 'MANUAL' AND c.kind <> 'MANUAL_ENTRY');
  IF bad > 0 THEN failures := failures || format(E'\n  %s participação(ões) com origem incompatível com a campanha', bad); END IF;

  SELECT count(*) INTO bad FROM prospecting_targets t JOIN sales_campaigns c ON c.id = t.campaign_id
  WHERE c.kind <> 'STANDARD' OR c.organization_id <> t.organization_id
     OR c.identity_key <> pg_temp.cm_identity(t.business_type, t.city, t.state);
  IF bad > 0 THEN failures := failures || format(E'\n  %s alvo(s) em campanha de outro segmento/cidade/estado', bad); END IF;

  SELECT count(*) INTO bad FROM scrape_jobs j JOIN sales_campaigns c ON c.id = j.campaign_id
  WHERE c.organization_id <> j.organization_id;
  IF bad > 0 THEN failures := failures || format(E'\n  %s busca(s) em campanha de outra organização', bad); END IF;

  SELECT count(*) INTO bad FROM outreach_messages m JOIN leads l ON l.id = m.lead_id
  WHERE m.campaign_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales_campaigns c WHERE c.id = m.campaign_id AND c.organization_id = m.organization_id);
  IF bad > 0 THEN failures := failures || format(E'\n  %s mensagem(ns) em campanha de outra organização', bad); END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'Verificação da migration de campanhas falhou:%', failures;
  END IF;
END
$$;
