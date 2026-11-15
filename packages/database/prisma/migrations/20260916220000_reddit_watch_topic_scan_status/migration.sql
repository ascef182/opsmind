-- Histórico da última tentativa de scan (Trilha "monitoramento não funciona",
-- plano pensando-como-empresa-com-agile-beaver.md, sprint E4). Escrita à mão
-- pelo mesmo motivo documentado em 20260914120000_deals: `prisma migrate dev`
-- não roda de forma utilizável neste ambiente. Aplicada via
-- `prisma migrate deploy`. Só ALTER TABLE — RLS já cobre a tabela inteira
-- (20260827164710_enable_row_level_security), colunas novas não precisam de
-- policy própria.

-- AlterTable
ALTER TABLE "reddit_watch_topics"
  ADD COLUMN "last_scanned_at" TIMESTAMP(3),
  ADD COLUMN "last_scan_status" TEXT,
  ADD COLUMN "last_scan_error" TEXT;
