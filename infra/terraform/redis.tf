# Memorystore — opcional (var.enable_memorystore, default false). Sem free
# tier: mesmo o menor tier Basic (1GB, sem HA) tem custo recorrente. Padrão
# é NÃO provisionar e usar `var.redis_url` apontando pra um Redis gratuito
# externo (ex.: Upstash) — ver variables.tf.
resource "google_redis_instance" "main" {
  count          = var.enable_memorystore ? 1 : 0
  name           = "opsmind-${var.environment}"
  tier           = "BASIC"
  memory_size_gb = 1
  region         = var.gcp_region

  authorized_network = google_compute_network.main.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  depends_on = [google_service_networking_connection.private_services]
}

locals {
  redis_url = var.enable_memorystore ? "redis://${google_redis_instance.main[0].host}:${google_redis_instance.main[0].port}" : var.redis_url
}
