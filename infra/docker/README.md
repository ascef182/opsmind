# infra/docker

`docker-compose.yml` sobe `postgres` (com pgvector, ver `init/01-extensions.sql`/`init/02-app-role.sql`) e
`redis`, usados por `apps/api`/`apps/worker` em desenvolvimento local (ver `pnpm dev` em `CLAUDE.md`).

## Serviço `camofox`

O serviço `camofox` builda a imagem direto do repositório oficial
(`https://github.com/jo-inc/camofox-browser.git`) via `build.context` como URL git. Esse caminho **não foi
testado nesta sessão** — nenhum build Docker de verdade rodou aqui — então se `docker compose up camofox`
falhar (por exemplo, se o Dockerfile do projeto não estiver na raiz do repo, ou se o Compose usado não
suportar builds a partir de URL git da forma esperada), use o fallback manual abaixo, e aponte
`CAMOFOX_API_URL` (`.env`, `packages/config/env/schema.ts`) pra `http://localhost:9377` (ou onde o processo
ficar escutando):

```bash
git clone https://github.com/jo-inc/camofox-browser
cd camofox-browser
npm install
npm start
```

`CAMOFOX_ACCESS_KEY` (opcional) precisa bater com a variável equivalente configurada no processo do camofox
(veja o README do projeto) para os gateways em `packages/integrations` (`camofox-gateway.ts`) autenticarem
via `Authorization: Bearer`.
