# Service account dedicada de runtime — NUNCA a default compute service
# account do projeto (que normalmente tem papel Editor amplo demais).
# "Camada extra de segurança em tudo": least privilege até na infra, não só
# no código (mesma diretriz aplicada em toda a Fase 3+ deste projeto).
resource "google_service_account" "runtime" {
  account_id   = "opsmind-${substr(var.environment, 0, 14)}"
  display_name = "OpsMind ${var.environment} — runtime dos serviços Cloud Run"
}

# Acesso aos secrets — só aos QUE ESTE PROJETO CRIA (via for_each no mesmo
# mapa de secrets.tf), nunca um `roles/secretmanager.admin` genérico.
resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each  = local.secrets
  secret_id = google_secret_manager_secret.app[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# Leitura de imagens do Artifact Registry — necessário pro Cloud Run puxar
# as imagens que o CI publica lá.
resource "google_artifact_registry_repository_iam_member" "runtime_reader" {
  repository = google_artifact_registry_repository.main.name
  location   = google_artifact_registry_repository.main.location
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.runtime.email}"
}
