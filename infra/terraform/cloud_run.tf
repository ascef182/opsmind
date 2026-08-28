locals {
  # Cloud Run injeta `PORT` automaticamente (8080) — nenhum dos 3 containers
  # define a variável explicitamente; tanto o Nest (env.PORT,
  # packages/config/env/schema.ts) quanto o `server.js` standalone do
  # Next.js já leem `process.env.PORT` sozinhos.
  common_secret_env = {
    DATABASE_URL       = "database-url"
    DATABASE_URL_APP   = "database-url-app"
    REDIS_URL          = "redis-url"
    JWT_ACCESS_SECRET  = "jwt-access-secret"
    JWT_REFRESH_SECRET = "jwt-refresh-secret"
    ANTHROPIC_API_KEY  = "anthropic-api-key"
    OPENAI_API_KEY     = "openai-api-key" # Fase 4 (Documents/RAG) — sem efeito em apps/api enquanto essa fase não estiver mesclada, deixado aqui pra não precisar retocar o Terraform depois.
    SENTRY_DSN         = "sentry-dsn"
  }
}

resource "google_cloud_run_v2_service" "api" {
  name       = "opsmind-api-${var.environment}"
  location   = var.gcp_region
  depends_on = [google_project_service.required]

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = 0 # escala a zero fora de uso — API stateless, sem custo quando ninguém acessa.
      max_instance_count = 3
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY" # só Cloud SQL/Memorystore passam pela VPC; chamadas à Anthropic/OpenAI/etc. saem direto pela internet.
      network_interfaces {
        network    = google_compute_network.main.id
        subnetwork = google_compute_subnetwork.main.id
      }
    }

    containers {
      image = "${local.registry_url}/api:latest" # CI/CD publica uma tag real a cada deploy — `latest` aqui é só o estado inicial antes do primeiro push.

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "CORS_ORIGIN"
        value = var.cors_origin
      }

      dynamic "env" {
        for_each = local.common_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service" "web" {
  name       = "opsmind-web-${var.environment}"
  location   = var.gcp_region
  depends_on = [google_project_service.required]

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    # apps/web não fala com Cloud SQL/Memorystore diretamente (só com a API,
    # via HTTP público) — sem vpc_access aqui, só o api service precisa.

    containers {
      image = "${local.registry_url}/web:latest"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
}

# Ambos os serviços HTTP acessíveis publicamente (Cloud Run é privado por
# padrão) — a autenticação de verdade é feita pela própria aplicação
# (JWT), não pela borda de rede do GCP.
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Worker (Fase 5) — sem HTTP, só consome a fila BullMQ. `min_instance_count
# = 1` obrigatório: diferente de api/web, não há requisição HTTP pra
# "acordar" o worker sob demanda — ele precisa estar sempre rodando pra
# processar jobs e pro scan periódico funcionar.
resource "google_cloud_run_v2_worker_pool" "worker" {
  name       = "opsmind-worker-${var.environment}"
  location   = var.gcp_region
  depends_on = [google_project_service.required]

  # `scaling` é atributo do RECURSO aqui (diferente de google_cloud_run_v2_service,
  # onde fica dentro de `template`) — descoberto via `terraform providers schema`,
  # não por tentativa e erro às cegas.
  scaling {
    manual_instance_count = 1
  }

  template {
    service_account = google_service_account.runtime.email

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.main.id
        subnetwork = google_compute_subnetwork.main.id
      }
    }

    containers {
      image = "${local.registry_url}/worker:latest"

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      dynamic "env" {
        for_each = local.common_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
}
