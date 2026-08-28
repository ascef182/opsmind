# infra/terraform — deploy no GCP (Fase 6)

Provisiona: VPC própria + peering privado, Cloud SQL (Postgres 16), Secret
Manager, Artifact Registry, Cloud Run (`api`, `web` como serviços HTTP,
`worker` como worker pool) e uma service account de runtime com permissões
mínimas. Memorystore (Redis) é opcional — ver `variables.tf`.

**Estado atual: escrito e validado (`terraform validate` + `terraform plan`
contra o projeto real `opsmind-506917`, 47 recursos, 0 erros), nunca
aplicado (`terraform apply`).** Provisionar isso custa dinheiro de verdade
(Cloud SQL sozinho: ~US$10-15/mês só de instância `db-f1-micro`, mesmo sem
tráfego) — a decisão de aplicar é sua, não algo pra automatizar.

## Pré-requisitos

- `gcloud auth login` + `gcloud auth application-default login` (Terraform
  usa as Application Default Credentials, não o login do `gcloud` sozinho).
- `gcloud config set project opsmind-506917` (ou o projeto que for usar).
- Nenhuma API do GCP precisa estar habilitada manualmente antes —
  `apis.tf` habilita todas via Terraform.

## Como rodar

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# preencher terraform.tfvars — NUNCA commitar esse arquivo (já gitignored)
terraform init
terraform plan    # revisar com atenção — confirma o que vai ser criado/custo
terraform apply   # só depois de revisar o plan
```

## Dependência circular CORS_ORIGIN / NEXT_PUBLIC_API_URL

`cors_origin` (da API) precisa da URL do `web`, e `web_public_api_url` (do
build do `web`) precisa da URL da `api` — mas as duas só existem depois do
primeiro `apply`. Fluxo pra resolver:

1. Primeiro `apply` com valores provisórios (`https://placeholder.invalid`)
   nas duas variáveis — cria os serviços Cloud Run com uma imagem
   `:latest` que ainda não existe (Cloud Run aceita a definição do serviço
   mesmo sem a imagem existir ainda; ele só falha ao tentar rodar uma
   revisão).
2. `terraform output api_url` / `terraform output web_url` — pegar as URLs
   reais.
3. Build + push das imagens reais (ver `.github/workflows/` — CI/CD ainda
   não tem um step de deploy automatizado; por ora, build/push manual:
   `docker build -f apps/api/Dockerfile -t $(terraform output -raw
   artifact_registry_url)/api:v1 . && docker push ...`, idem pra
   `web`/`worker`, `web` precisa do `--build-arg
   NEXT_PUBLIC_API_URL=<api_url real>`).
4. Reaplicar com `cors_origin`/`web_public_api_url` atualizados pros
   valores reais (e as imagens `:v1` reais, não mais `:latest`).

## Bootstrap manual do banco (pós-apply, uma vez)

Cloud SQL não roda init scripts como o Docker Compose local — ver o
comentário no fim de `database.tf` pro passo a passo (habilitar `pgvector`,
rodar as migrations, aplicar os GRANTs da role `opsmind_app`).

## O que fica de fora de propósito

- **Backend remoto de state** (`versions.tf` tem um bloco comentado) — o
  nome do bucket é uma decisão sua, não decidi por você.
- **CI/CD de deploy automatizado** — o CI atual (`.github/workflows/ci.yml`)
  só faz lint/typecheck/test/e2e; publicar imagem + `terraform apply`/
  `gcloud run deploy` a cada merge em `main` é um passo seguinte, não
  incluído aqui.
- **Memorystore habilitado por padrão** — tem custo recorrente sem free
  tier; `enable_memorystore = false` usa `var.redis_url` (ex.: um Redis
  gratuito externo) em vez disso.
