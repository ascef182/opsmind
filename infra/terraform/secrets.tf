# Um Secret do Secret Manager por variável sensível — nunca um `.env`
# inteiro num secret só (rotação/auditoria por variável individual, e
# `google_cloud_run_v2_service` referencia secrets um a um mais abaixo,
# então a granularidade já é essa de qualquer forma).
locals {
  database_url     = "postgresql://opsmind:${var.database_password}@${google_sql_database_instance.main.private_ip_address}/opsmind?schema=public"
  database_url_app = "postgresql://opsmind_app:${var.app_role_password}@${google_sql_database_instance.main.private_ip_address}/opsmind?schema=public"

  secrets = {
    database-url       = local.database_url
    database-url-app   = local.database_url_app
    redis-url          = local.redis_url
    jwt-access-secret  = var.jwt_access_secret
    jwt-refresh-secret = var.jwt_refresh_secret
    anthropic-api-key  = var.anthropic_api_key
    openai-api-key     = var.openai_api_key
    sentry-dsn         = var.sentry_dsn
  }
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secrets
  secret_id = "opsmind-${var.environment}-${each.key}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.app[each.key].id
  secret_data = each.value
}
