# dnschkr-reverse-ip

Backend microservice for the Reverse IP Domain Check tool at [reverseip.dnschkr.com](https://reverseip.dnschkr.com).

Queries the Project Echo ClickHouse data set (~258M domains, weekly refreshed) via `echo-query.dnschkr.com` and returns hostname lists for an IP, plus IP intelligence enrichment from `ip.dnschkr.com`.

## Endpoints

- `GET /health` — Coolify probe (no auth)
- `POST /lookup` — Main reverse-IP query (Bearer auth)
- `POST /jobs/generate-export` — Async export generation triggered by dnschkr-site Stripe webhook (Bearer auth)

## Local development

```bash
pnpm install
cp .env.example .env.local
# fill in values from 1Password
pnpm dev
```

## Deployment

Coolify on synergyutility. Auto-deploys on push to `master`. UUID assigned in Task 7.

## Architecture

- **Stack:** Hono + Node 20 + TypeScript
- **Data sources:**
  - ClickHouse via `echo-query.dnschkr.com` (read-only `tools_ro` user)
  - IP intelligence via `ip.dnschkr.com`
- **Auth:** Bearer token in `Authorization` header (32+ char shared secret with dnschkr-site)
- **Async work:** in-process p-queue (no BullMQ for v1)
- **Repo of record:** Plan B at `dnschkr/dnschkr-site/docs/superpowers/plans/2026-04-27-reverse-ip-domain-check-tool.md`
