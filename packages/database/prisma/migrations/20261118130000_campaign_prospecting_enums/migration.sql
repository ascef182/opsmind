-- Campanhas de prospecção (docs/superpowers/specs/2026-11-18-campanhas-prospeccao-design.md).
-- Só enums: o Postgres não deixa usar um valor novo de enum na mesma transação
-- em que ele foi criado, então quem usa PAUSED/COMPLETED vem nas migrations seguintes.

CREATE TYPE "CampaignKind" AS ENUM ('STANDARD', 'GENERAL', 'LEGACY', 'MANUAL_ENTRY');
CREATE TYPE "CampaignCreationSource" AS ENUM ('USER', 'AUTO_FROM_SEARCH', 'MIGRATION');
CREATE TYPE "CampaignLeadOrigin" AS ENUM ('SEARCH', 'MANUAL', 'BACKFILL_EXACT', 'LEGACY');
CREATE TYPE "LeadEntityType" AS ENUM ('BUSINESS', 'PROFESSIONAL', 'DIRECTORY', 'INTERNAL_PAGE', 'IRRELEVANT', 'UNKNOWN');
CREATE TYPE "OutreachCampaignAttribution" AS ENUM ('DRAFT_CONTEXT', 'UNIDENTIFIED_LEGACY');
CREATE TYPE "DuplicateCandidateStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');

ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
