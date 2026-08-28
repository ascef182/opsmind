variable "gcp_project_id" {
  description = "ID do projeto GCP (ex.: opsmind-506917)."
  type        = string
}

variable "gcp_region" {
  description = "Região GCP pra todos os recursos regionais."
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Sufixo de ambiente nos nomes de recursos (production, staging, etc.)."
  type        = string
  default     = "production"
}

# ── Cloud SQL ────────────────────────────────────────────────────────────

variable "database_tier" {
  description = "Tier da instância Cloud SQL. db-f1-micro é o mais barato disponível (compartilhado, sem HA) — adequado pra portfolio/demo, não pra produção de verdade com tráfego real."
  type        = string
  default     = "db-f1-micro"
}

variable "database_password" {
  description = "Senha da role dona das tabelas (superuser do Cloud SQL) — nunca comitada; passar via TF_VAR_database_password ou -var na hora do apply."
  type        = string
  sensitive   = true
}

variable "app_role_password" {
  description = "Senha da role restrita de runtime (opsmind_app, sem BYPASSRLS — a mesma função de infra/docker/init/02-app-role.sql, criada aqui via null_resource/provisioner após a instância existir, não automaticamente pelo Cloud SQL)."
  type        = string
  sensitive   = true
}

# ── Redis ────────────────────────────────────────────────────────────────

variable "enable_memorystore" {
  description = "Provisiona Memorystore (Redis gerenciado) — tem custo mínimo recorrente (~US$35+/mês mesmo no menor tier Basic), sem free tier. `false` por padrão: nesse caso, configure `redis_url` manualmente (ex.: um Redis gratuito como Upstash) em vez de provisionar Memorystore."
  type        = bool
  default     = false
}

variable "redis_url" {
  description = "REDIS_URL a usar quando enable_memorystore = false (ex.: instância gratuita do Upstash). Ignorado quando enable_memorystore = true (o valor real do Memorystore é usado nesse caso)."
  type        = string
  default     = ""
  sensitive   = true
}

# ── Segredos de aplicação (Secret Manager) ──────────────────────────────

variable "jwt_access_secret" {
  description = "JWT_ACCESS_SECRET — mín. 32 caracteres (mesma validação do schema de env em packages/config)."
  type        = string
  sensitive   = true
}

variable "jwt_refresh_secret" {
  description = "JWT_REFRESH_SECRET — mín. 32 caracteres."
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "ANTHROPIC_API_KEY — opcional (mesma filosofia do schema de env: sem ela, o assistente de IA falha só no primeiro uso, o resto da API funciona normalmente)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "openai_api_key" {
  description = "OPENAI_API_KEY — opcional (Fase 4, upload de documentos/RAG)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "sentry_dsn" {
  description = "SENTRY_DSN — opcional (Fase 6, observabilidade)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cors_origin" {
  description = "Origem permitida por CORS na API — normalmente a URL pública do serviço web."
  type        = string
}

variable "web_public_api_url" {
  description = "NEXT_PUBLIC_API_URL — inlinado no build do apps/web (build-time, não runtime); precisa da URL pública da API já conhecida antes do build da imagem."
  type        = string
}
