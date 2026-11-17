-- Negócios que cadastraram no Google Maps um perfil social ou "link na bio"
-- no campo de site (facebook.com, instagram.com, linktr.ee, *.bio, wa.me...)
-- eram tratados como "tem site": perdiam os pontos de "sem site" e caíam como
-- DISQUALIFIED, justamente o perfil que mais precisa de um site. A partir
-- desta versão o worker classifica na entrada (`classifyBusinessWebsite`,
-- @opsmind/shared-types); esta migration corrige as linhas existentes com a
-- mesma lista de hosts:
--   1. o link sai de `website` e entra em `social_links` (sem duplicar);
--   2. lead que estava DISQUALIFIED por causa disso volta a DISCOVERED, com o
--      score antigo apagado (foi calculado com o dado errado). O novo score
--      sai na próxima vez que o lead for pontuado ou re-raspado; não é
--      recalculado aqui para não disparar rascunhos de IA (custo) sozinho.

CREATE TEMP TABLE social_website_leads AS
SELECT
  id,
  organization_id,
  status,
  website,
  CASE
    WHEN host ~ '(^|\.)(facebook\.com|fb\.com|fb\.me)$' THEN 'FACEBOOK'
    WHEN host ~ '(^|\.)(instagram\.com|instagr\.am|instagran\.com)$' THEN 'INSTAGRAM'
    WHEN host ~ '(^|\.)(wa\.me|wa\.link|whatsapp\.com)$' THEN 'WHATSAPP'
    WHEN host ~ '(^|\.)linkedin\.com$' THEN 'LINKEDIN'
    WHEN host ~ '(^|\.)tiktok\.com$' THEN 'TIKTOK'
    WHEN host ~ '(^|\.)(twitter\.com|x\.com)$' THEN 'TWITTER'
    WHEN host ~ '(^|\.)(youtube\.com|youtu\.be)$' THEN 'YOUTUBE'
    WHEN host ~ '(^|\.)(linktr\.ee|beacons\.ai|bio\.link|linkin\.bio|taplink\.cc|campsite\.bio)$' OR host ~ '\.bio$' THEN 'OTHER'
  END AS platform
FROM (
  SELECT id, organization_id, status, website,
         lower(substring(website from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')) AS host
  FROM leads
  WHERE website IS NOT NULL
) candidates;

DELETE FROM social_website_leads WHERE platform IS NULL;

UPDATE leads l SET
  website = NULL,
  social_links = CASE
    WHEN COALESCE(l.social_links, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('url', s.website))
      THEN l.social_links
    ELSE COALESCE(l.social_links, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('platform', s.platform, 'url', s.website))
  END
FROM social_website_leads s
WHERE l.id = s.id;

INSERT INTO pipeline_stage_transitions (id, organization_id, lead_id, from_stage, to_stage, actor_type, occurred_at)
SELECT gen_random_uuid()::text, organization_id, id, 'DISQUALIFIED', 'DISCOVERED', 'SYSTEM', now()
FROM social_website_leads
WHERE status = 'DISQUALIFIED';

UPDATE leads l SET status = 'DISCOVERED', score = NULL, score_breakdown = NULL, suggested_offering_id = NULL
FROM social_website_leads s
WHERE l.id = s.id AND s.status = 'DISQUALIFIED';

DROP TABLE social_website_leads;
