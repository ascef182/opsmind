# Fase 6 (PRD §15/§17): "Docker + Terraform + GCP". Este arquivo e os
# seguintes em infra/terraform/ foram escritos e validados com
# `terraform validate` (e revisados com `terraform plan` contra o projeto
# GCP real `opsmind-506917`) — mas NUNCA `terraform apply`. Provisionar
# infraestrutura de verdade custa dinheiro e é uma ação de fora pra dentro
# difícil de reverter sem sobra (dados em disco, DNS, etc.); isso exige
# confirmação explícita da sua parte, não é algo pra eu decidir sozinho.
# Quando quiser aplicar: revise `terraform plan` com atenção especial ao
# custo (Cloud SQL e, se habilitado, Memorystore são os itens caros) antes
# de confirmar o `apply`.

terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Sem backend remoto configurado de propósito (fica local por padrão) —
  # configurar um bucket GCS como backend é o primeiro passo antes de
  # qualquer `apply` de verdade, pra não depender do state ficar só numa
  # máquina. Deixado como TODO explícito em vez de decidido por mim (nome
  # do bucket, região, etc. são decisões suas).
  # backend "gcs" {
  #   bucket = "TODO-nome-do-bucket-de-state"
  #   prefix = "opsmind"
  # }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}
