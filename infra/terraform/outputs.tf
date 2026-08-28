output "api_url" {
  value       = google_cloud_run_v2_service.api.uri
  description = "URL pública da API — usar como var.web_public_api_url no build do web."
}

output "web_url" {
  value       = google_cloud_run_v2_service.web.uri
  description = "URL pública do frontend — usar como var.cors_origin."
}

output "artifact_registry_url" {
  value       = local.registry_url
  description = "Prefixo de imagem pra `docker push` (ex.: docker push $(terraform output -raw artifact_registry_url)/api:TAG)."
}

output "database_private_ip" {
  value       = google_sql_database_instance.main.private_ip_address
  description = "IP privado do Cloud SQL — só alcançável de dentro da VPC (Cloud Run com vpc_access, ou um bastion/Cloud SQL Auth Proxy pra acesso manual de fora)."
  sensitive   = true
}

output "runtime_service_account_email" {
  value       = google_service_account.runtime.email
  description = "Service account usada pelos 3 serviços Cloud Run — referência útil pra depurar permissões IAM."
}
