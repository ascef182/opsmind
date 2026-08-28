# APIs do GCP que os recursos abaixo precisam habilitadas no projeto.
# `disable_on_destroy = false`: um `terraform destroy` não deve desabilitar
# a API do projeto inteiro (outros serviços podem depender dela) — só
# remove os recursos que este Terraform criou.
locals {
  required_apis = [
    "run.googleapis.com",               # Cloud Run
    "sqladmin.googleapis.com",          # Cloud SQL
    "secretmanager.googleapis.com",     # Secret Manager
    "artifactregistry.googleapis.com",  # Artifact Registry
    "redis.googleapis.com",             # Memorystore (só usado se enable_memorystore)
    "vpcaccess.googleapis.com",         # Serverless VPC Access (Cloud Run -> Cloud SQL/Memorystore)
    "servicenetworking.googleapis.com", # Peering privado pro Cloud SQL
  ]
}

resource "google_project_service" "required" {
  for_each           = toset(local.required_apis)
  project            = var.gcp_project_id
  service            = each.value
  disable_on_destroy = false
}
