# DNSChkr Reverse IP Service

## Project Overview
Backend microservice for the Reverse IP Domain Check tool at `reverseip.dnschkr.com`. Returns the list of hostnames that resolve to a given IPv4/IPv6 address by querying the Project Echo ClickHouse data set (~258M domains, refreshed weekly), and enriches results with IP intelligence from `ip.dnschkr.com`.

Adapted from the `dnschkr-port-checker` template per the "New Service CLAUDE.md Standard" in `dnschkr-site/CLAUDE.md`.

## Tech Stack
- **Runtime:** Node.js 20+ with TypeScript (ESM)
- **Framework:** Hono (lightweight HTTP framework)
- **ClickHouse client:** `@clickhouse/client` — read-only queries against `echo-query.dnschkr.com` (`tools_ro` user)
- **Validation:** Zod + `@hono/zod-validator`
- **Async work:** in-process `p-queue` (no BullMQ for v1)
- **Containerization:** Docker (Node 20 Alpine, multi-stage) — added in Task 7

## Key Commands
```bash
pnpm dev          # Development with hot reload (tsx watch)
pnpm build        # Compile TypeScript to dist/
pnpm start        # Production (node dist/index.js)
pnpm test         # Run vitest suite
pnpm lint         # Type-check (tsc --noEmit)
```

## API Endpoints
- `GET /health` — Coolify probe (no auth)
- `POST /lookup` — Reverse-IP query (Bearer auth) — returns `{ ip, hostnames[], total, truncated, ipIntel }`
- `POST /jobs/generate-export` — Async export job triggered by dnschkr-site Stripe webhook (Bearer auth)

Detailed endpoint contracts live in `dnschkr-site/docs/superpowers/plans/2026-04-27-reverse-ip-domain-check-tool.md`.

## Architecture
- Bearer token auth on all routes except `/health` (`API_KEY` env var, shared with dnschkr-site as `REVERSE_IP_API_KEY`)
- ClickHouse read-only access via the `tools_ro` user (no DDL, no DML)
- Result truncation at a configurable limit (default 1,000 hostnames per IP for the public tool; full export goes through the async job route)
- IP intelligence enrichment via `ip.dnschkr.com` (geo, ASN, threat data) — fire-and-forget alongside the ClickHouse query
- Rejects private/loopback ranges (127.x, 10.x, 192.168.x, 172.16-31.x, fc/fd::/7, etc.)
- Async exports written to S3 (`dnschkr-data-571471188499`) with HMAC-signed download URLs, then Supabase `download_purchases` row updated and an SES email is sent

## Environment Variables
See `.env.example`. Key vars:
```
PORT=3300
API_KEY=                          # Shared with dnschkr-site (REVERSE_IP_API_KEY)
CLICKHOUSE_URL=https://echo-query.dnschkr.com
CLICKHOUSE_USER=tools_ro
CLICKHOUSE_PASSWORD=
IP_SERVICE_URL=https://ip.dnschkr.com
IP_SERVICE_API_KEY=
DOWNLOAD_FINGERPRINT_SECRET=      # MUST match dnschkr-site's value
S3_DOWNLOADS_BUCKET=dnschkr-data-571471188499
S3_DOWNLOADS_REGION=us-east-1
AWS_SES_FROM_DOWNLOADS=downloads@dnschkr.com
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_NOTIFICATION=FALSE
```

## Important Patterns
- TypeScript ESM: all relative imports must use `.js` extensions (e.g. `from "./config.js"`)
- Same Bearer-token auth pattern as `dnschkr-ip` and `dnschkr-port-checker`
- Domain: `reverseip.dnschkr.com` (Cloudflare proxied)
- `noUncheckedIndexedAccess: true` is on — handle `undefined` from array/object indexing explicitly

## Project Structure (target — scaffolded in Task 3, fleshed out in Tasks 4-24)
```
src/
├── index.ts                  # Hono app, CORS, auth middleware, mount routes
├── config.ts                 # Config loaded + validated from env vars (Task 4)
├── types.ts                  # Shared types (Task 4)
├── routes/
│   ├── lookup.ts             # POST /lookup (Task 13)
│   └── jobs/
│       └── generate-export.ts  # POST /jobs/generate-export (Task 24)
├── lib/
│   ├── auth.ts               # Bearer token middleware (Task 5)
│   ├── rate-limit.ts         # In-memory rate limiter (Task 5)
│   └── logger.ts             # Lightweight structured logger (Task 5)
└── workers/                  # Async export workers (Task 24)
tests/                        # Vitest suite
```

## Coolify Deployment

> Status: TBD — UUID assigned and Dockerfile + Coolify wiring added in Task 7. The steps below are the standard pattern to follow.

### Prerequisites
1. A Coolify server with Docker (planned target: `synergyutility`)
2. The `coolify` CLI installed (`/usr/local/bin/coolify` v1.4.0+)
3. The dnschkr GitHub App connected to Coolify (`vc0wosc0kcokgskw8s0sgwww`)

### First-Time Setup

#### 1. Create the application in Coolify
```bash
coolify app create \
  --project-uuid <project-uuid> \
  --server-uuid ngs404gg4c8owcskk8s8ss4c \
  --name "dnschkr-reverse-ip" \
  --git-repository "https://github.com/dnschkr/dnschkr-reverse-ip" \
  --git-branch "master" \
  --build-pack dockerfile \
  --port 3300
```

Or via the Coolify web UI:
1. Project → New Resource → Application
2. Select server (`synergyutility` recommended)
3. Connect `dnschkr/dnschkr-reverse-ip` via the GitHub App
4. Build pack: Dockerfile
5. Exposed port: `3300`

#### 2. Set environment variables
```bash
API_KEY=$(openssl rand -hex 32)
echo "Generated API_KEY: $API_KEY"

coolify app env create <app-uuid> --key API_KEY --value "$API_KEY"
coolify app env create <app-uuid> --key PORT --value "3300"
# ...sync the rest of the vars from .env (see .env.example)
```

#### 3. Configure domain
Set the Coolify app domain to `reverseip.dnschkr.com`.

#### 4. DNS Setup
Cloudflare A record:
```
reverseip.dnschkr.com → A → <synergyutility-ip> (Cloudflare proxied)
```

#### 5. Deploy
```bash
coolify deploy <app-uuid>
```

#### 6. Configure dnschkr-site env vars
On `jgcskoc4ggcwo8ccckocw8sg`:
```bash
coolify app env create jgcskoc4ggcwo8ccckocw8sg --key REVERSE_IP_SERVICE_URL --value "https://reverseip.dnschkr.com"
coolify app env create jgcskoc4ggcwo8ccckocw8sg --key REVERSE_IP_API_KEY --value "$API_KEY"
```
The API_KEY must match between both services.

#### 7. Verify
```bash
curl https://reverseip.dnschkr.com/health
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ip":"1.1.1.1"}' \
  https://reverseip.dnschkr.com/lookup
```

### Infrastructure
| Resource | UUID | Domain |
|----------|------|--------|
| **Reverse IP App** | TBD (Task 7) | `reverseip.dnschkr.com` |
| **Server (synergyutility)** | `ngs404gg4c8owcskk8s8ss4c` | `178.156.178.213` |
| **GitHub App (dnschkr)** | `vc0wosc0kcokgskw8s0sgwww` | — |

### Common Operations
```bash
coolify deploy <app-uuid>
coolify app logs <app-uuid>
coolify app env sync <app-uuid> --file .env
coolify app get <app-uuid> --format pretty
curl https://reverseip.dnschkr.com/health
```

### Coolify CLI Quick Reference
```bash
coolify app list
coolify app get <uuid> --format pretty
coolify app env list <uuid>
coolify app env create <uuid> --key K --value V
coolify deploy <uuid>
coolify app restart <uuid>
coolify app logs <uuid>
coolify app deployments list <uuid>
```

## Integration with dnschkr-site
The main site calls this service from API routes:
- `POST dnschkr.com/api/reverse-ip/lookup` → `POST reverseip.dnschkr.com/lookup`
- Stripe webhook handler → `POST reverseip.dnschkr.com/jobs/generate-export` for paid full-IP exports
- Visitor IP forwarded via `X-Forwarded-For` for logging
- Env vars on site: `REVERSE_IP_SERVICE_URL`, `REVERSE_IP_API_KEY`

## Consumer Page on dnschkr.com
- **Reverse IP Domain Check** (`/reverse-ip`) — UI + free-tier limited results, paid full export via the platform downloads framework

---

## Engineering Principles (Karpathy Guidelines)

Apply these four principles when writing, reviewing, or refactoring code in this project. Bias toward caution over speed; for trivial tasks, use judgment. Source: Andrej Karpathy's observations on LLM coding pitfalls (https://x.com/karpathy/status/2015883857489522876).

### 1. Think Before Coding
Surface assumptions and tradeoffs. Don't pick silently among multiple interpretations — present them. If something is unclear, name what's confusing and ask. Push back when a simpler approach exists.

### 2. Simplicity First
Minimum code that solves the problem. No features beyond what was asked, no abstractions for single-use code, no "flexibility" or "configurability" not requested, no error handling for impossible scenarios.

### 3. Surgical Changes
Touch only what you must. Don't "improve" adjacent code, comments, or formatting. Match existing style. Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define verifiable success criteria before starting. Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
