# infra/docker

`docker-compose.yml` sobe `postgres` (com pgvector, ver `init/01-extensions.sql`/`init/02-app-role.sql`) e
`redis`, usados por `apps/api`/`apps/worker` em desenvolvimento local (ver `pnpm dev` em `CLAUDE.md`).

## Serviço `camofox`

O serviço `camofox` builda a imagem direto do repositório oficial
(`https://github.com/jo-inc/camofox-browser.git`) via `build.context` como URL git. O build em si funciona
(confirmado ao vivo em 2026-09-17), mas **em host Apple Silicon (Docker Desktop em Mac arm64) o container não
funciona**: o binário `camoufox-bin` (fork do Firefox) baixado dentro da imagem é x86_64, e falha ao rodar via
Rosetta num container Linux arm64 (`rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2` — faltam
libs x86_64 no rootfs arm64). Nesse caso (ou se `docker compose up camofox` falhar por qualquer outro motivo,
como o Dockerfile do projeto não estar na raiz do repo), use o fallback manual abaixo — roda o processo nativo
no host, sem esse problema de arquitetura — e aponte `CAMOFOX_API_URL` (`.env`,
`packages/config/env/schema.ts`) pra `http://localhost:9377` (ou onde o processo ficar escutando):

```bash
git clone https://github.com/jo-inc/camofox-browser
cd camofox-browser
npm install
npm start
```

`CAMOFOX_ACCESS_KEY` (opcional) precisa bater com a variável equivalente configurada no processo do camofox
(veja o README do projeto) para os gateways em `packages/integrations` (`camofox-gateway.ts`) autenticarem
via `Authorization: Bearer`.
