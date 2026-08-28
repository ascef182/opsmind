# Postgres 16 — mesma major version do `pgvector/pgvector:pg16` usado em
# dev (infra/docker/docker-compose.yml). Cloud SQL para Postgres suporta a
# extensão `vector` nativamente desde 15+ (sem flag especial) — habilitada
# no bootstrap manual pós-apply, ver comentário no fim deste arquivo.
resource "google_sql_database_instance" "main" {
  name             = "opsmind-${var.environment}"
  database_version = "POSTGRES_16"
  region           = var.gcp_region
  depends_on       = [google_service_networking_connection.private_services]

  settings {
    tier = var.database_tier

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.main.id
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
  }

  # `db-f1-micro` (o tier padrão, mais barato) não tem HA nem suporta
  # `deletion_protection` combinado com alguns tiers antigos com segurança —
  # mantido `true` de qualquer forma: apagar essa instância por engano
  # (`terraform destroy` sem querer) perderia todos os dados de produção.
  # Precisa ser desabilitado explicitamente (`terraform apply
  # -var deletion_protection=false` ou editando aqui) antes de um destroy
  # intencional.
  deletion_protection = true
}

resource "google_sql_database" "opsmind" {
  name     = "opsmind"
  instance = google_sql_database_instance.main.name
}

# Role dona das tabelas — equivalente à role `opsmind` local (superuser do
# Postgres gerenciado pelo Cloud SQL, usada só por `prisma migrate`/seed,
# nunca pela API em runtime).
resource "google_sql_user" "owner" {
  name     = "opsmind"
  instance = google_sql_database_instance.main.name
  password = var.database_password
}

# Role restrita de runtime — equivalente a `opsmind_app`
# (infra/docker/init/02-app-role.sql). O Cloud SQL não roda init scripts
# como o Docker Compose local; os GRANTs/ALTER DEFAULT PRIVILEGES desse
# arquivo precisam ser aplicados manualmente contra esta instância (via
# Cloud SQL Auth Proxy + psql, ou Cloud SQL Studio) na primeira vez, depois
# do `terraform apply` E depois da primeira `prisma migrate deploy` (a role
# só pode receber grant sobre tabelas que já existem). Mesmo passo manual
# de sempre, só que contra o Cloud SQL em vez do Postgres local.
resource "google_sql_user" "app" {
  name     = "opsmind_app"
  instance = google_sql_database_instance.main.name
  password = var.app_role_password
}

# ── Bootstrap pós-apply (documentado aqui, não automatizado) ─────────────
# 1. `gcloud sql connect opsmind-${var.environment} --user=opsmind`
# 2. Rodar o conteúdo de infra/docker/init/01-extensions.sql (CREATE EXTENSION vector)
# 3. `DATABASE_URL=<Cloud SQL, role opsmind> pnpm db:migrate` (aplica as migrations)
# 4. Rodar o conteúdo de infra/docker/init/02-app-role.sql, MAS trocando
#    `CREATE ROLE opsmind_app WITH LOGIN PASSWORD '...'` por só os GRANTs —
#    a role em si já existe (google_sql_user.app acima), só falta autorizá-la
#    sobre as tabelas recém-criadas pelo migrate.
