-- Lead ganha campos de contato tipados (Task 6/10/11 do plano de prospecção
-- autônoma): `whatsapp`/`contact_name` são promovidos a coluna própria (em
-- vez de ficarem só dentro do JSON livre) porque precisam ser filtráveis
-- direto (`hasContactMethod`, Task 4) e `whatsapp` é o canal de outreach de
-- maior prioridade (Task 10/11). `social_links` continua JSON livre — a
-- policy de RLS de `leads` já cobre a linha inteira, sem migration de RLS
-- separada.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "whatsapp" TEXT,
ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "social_links" JSONB;
