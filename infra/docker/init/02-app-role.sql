-- Role de runtime para a API, separada da role dona das tabelas (`opsmind`,
-- usada só por migrations/seed). Row-Level Security não tem efeito nenhum
-- sobre o dono de uma tabela nem sobre superusuários — como o `POSTGRES_USER`
-- da imagem oficial do Postgres vira superuser automaticamente, a API precisa
-- conectar como uma role diferente, sem BYPASSRLS, para as policies valerem
-- de verdade. Ver docs/planning/reviews/database-reviewer-review.md §1.3.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'opsmind_app') THEN
    CREATE ROLE opsmind_app WITH LOGIN PASSWORD 'opsmind_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE opsmind TO opsmind_app;
GRANT USAGE ON SCHEMA public TO opsmind_app;

-- Tabelas que já existirem no momento em que este script rodar (nenhuma na
-- primeira inicialização — migrations rodam depois, como um passo separado).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO opsmind_app;

-- Tabelas futuras, criadas por `opsmind` via `prisma migrate`, recebem os
-- mesmos grants automaticamente — sem isso, toda migration nova exigiria um
-- GRANT manual antes de a API conseguir ler/escrever a tabela recém-criada.
ALTER DEFAULT PRIVILEGES FOR ROLE opsmind IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO opsmind_app;
