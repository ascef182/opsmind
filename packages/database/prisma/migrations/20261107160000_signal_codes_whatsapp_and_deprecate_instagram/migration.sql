-- Ajuste de vocabulário de sinais a partir de feedback real do time (ver
-- docs/planning/2026-11-06-harvey-inteligencia-comercial.md, seção de
-- revisão): "não tem Instagram" é ausência de evidência, não evidência de
-- ausência, e não é um critério de venda útil para nenhum dos três produtos
-- reais da CazaTech (DeskComm, sites, apps) — DEPRECATED, não DELETE (o
-- ciclo de vida existe exatamente pra isso: `LeadSignal` históricos
-- continuam existindo, só paramos de GRAVAR novos a partir de agora — ver o
-- filtro de governança em apps/worker/src/website-profiler-processor.ts).
--
-- Em contrapartida, "o negócio JÁ usa WhatsApp" é o sinal de compra real
-- pro DeskComm (CRM com IA pra WhatsApp): o alvo comercial é organizar/
-- automatizar um canal que já existe, não vender WhatsApp pra quem não tem.
-- Por isso o sinal novo é de PRESENÇA, não ausência, e com confiança mais
-- alta (0.85) que a maioria dos outros sinais — é evidência positiva
-- concreta (a URL real do link), não uma inferência por ausência.
--
-- `default_service_offering_id` fica NULL aqui de propósito: é um código
-- GLOBAL (visível pra toda organização), mas `ServiceOffering` é sempre
-- escopado a uma organização — um código global não pode apontar pra uma
-- oferta específica de um tenant sem favorecer esse tenant por acidente.
-- O mapeamento de "has_whatsapp_link -> oferta de CRM/WhatsApp" é feito à
-- parte, por organização (ver SignalCodesService), não nesta migration.

UPDATE "signal_codes" SET "status" = 'DEPRECATED' WHERE "code" = 'social.no_instagram';

INSERT INTO "signal_codes" ("code", "organization_id", "label", "category", "status") VALUES
    ('social.has_whatsapp_link', NULL, 'Já atende cliente pelo WhatsApp', 'social', 'CONFIRMED');
