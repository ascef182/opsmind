# Um repositório Docker só, compartilhado pelas 3 imagens (api/web/worker)
# — distinguidas pelo nome da imagem dentro do repositório, não por
# repositórios separados. `KEEP_COUNT` de 10 evita acumular imagens antigas
# indefinidamente (cada uma custa storage).
resource "google_artifact_registry_repository" "main" {
  repository_id = "opsmind"
  location      = var.gcp_region
  format        = "DOCKER"
  depends_on    = [google_project_service.required]

  cleanup_policies {
    id     = "keep-latest-10"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
}

locals {
  registry_url = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.main.repository_id}"
}
