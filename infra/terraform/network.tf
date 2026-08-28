# VPC própria (não a "default" do projeto) — Cloud SQL com IP privado e,
# se habilitado, Memorystore, precisam de peering de Service Networking;
# Cloud Run precisa de um VPC Access Connector pra alcançar esses IPs
# privados. Tudo dentro desta VPC isolada, não misturado com outros
# projetos/recursos que já existam no projeto GCP.

resource "google_compute_network" "main" {
  name                    = "opsmind-${var.environment}"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "main" {
  name          = "opsmind-${var.environment}"
  ip_cidr_range = "10.0.0.0/24"
  region        = var.gcp_region
  network       = google_compute_network.main.id
}

# Faixa reservada pro peering privado (Cloud SQL, e Memorystore se habilitado)
# — não é uma sub-rede "normal", é alocada pro Google gerenciar internamente.
resource "google_compute_global_address" "private_services" {
  name          = "opsmind-${var.environment}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
  depends_on              = [google_project_service.required]
}

# Sem VPC Access Connector: os 3 serviços Cloud Run (api/web/worker) usam
# Direct VPC Egress (`network_interfaces` em cloud_run.tf, direto na
# subnetwork acima) — mecanismo mais novo, sem o custo de instâncias extras
# de um connector rodando 24/7, e é o único suportado por
# `google_cloud_run_v2_worker_pool` (o connector legado só existe pra
# `google_cloud_run_v2_service`).
