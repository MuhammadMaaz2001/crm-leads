# Local Setup Report — Zero Cost CRM

**Date:** 2026-11-25 · **Machine:** Windows 11 · **Outcome:** ✅ App running locally, database initialised and seeded, login verified through the API.

## 1. Where to open it

| What | URL |
|---|---|
| **CRM (UI + API, single origin)** | **http://localhost:4100** |
| Health check | http://localhost:4100/api/health |
| API docs (Swagger) | http://localhost:4100/api/docs — **not available** in this mode (docs are off in production mode unless `ENABLE_API_DOCS=true`) |
| Local Postgres (container) | `127.0.0.1:5434`, database `brains_crm_test` |

**Login (local demo data only):** `founder.seed@convobrains.com` (role *founder* = full admin). The demo password is the one documented in `README.md` ("Run it in 3 steps"); it is not repeated here. Other seeded users, all SDR role: `rahul.seed@…`, `neha.seed@…`, `aman.seed@…` (`@convobrains.com`, same documented password).

Seeded data: 8 companies, 8 contacts, 3 days × 3 SDRs of sample activity.

## 2. Prerequisites check

| Tool | Result |
|---|---|
| Node.js | v24.14.0 ✅ (project needs ≥ 22) |
| npm | 11.9.0 ✅ |
| Docker Desktop / Compose | 29.8.2 / v5.5.1 ✅ |
| `make` | ❌ not installed (not needed — see §3) |
| `psql` | ❌ not installed (not needed — schema is applied through Node's `pg` by the test-prep script) |
| `node_modules` | already present — **no install or upgrade performed** |

## 3. Steps performed

1. Read `CRM_AUDIT.md`, `README.md`, `Makefile`, `testing/functional/*`, `.env.example`.
2. **Checked env files first:** `.env`, `.env.local` and `testing/functional/.env.testing` did **not** exist; nothing was overwritten.
3. Checked Docker and ports (see §4 for the findings).
4. Started the project's isolated test Postgres (documented `make test-up` equivalent):
   `docker compose -f testing/functional/docker-compose.yml up -d` → container `convobrains-crm-test-db` (healthy).
5. `npm run test:api:prep` (documented script): created `testing/functional/.env.testing` from the shipped `.env.testing.example` (git-ignored, local-only test values), applied `sql/schema.sql`, seeded users, CRM fixtures and activity.
6. `npm run build` → produced `dist/` (git-ignored).
7. Started the server in the background with the env file loaded into the process only (no `.env.local` created), overriding two variables: `PORT=4100`, `NODE_ENV=production` (so Express also serves the built frontend).
8. Verified over HTTP: health 200, SPA served, `/api/config` returns 13 stages / 10 statuses, login as founder succeeds, `/api/bootstrap` returns 8 companies / 8 contacts, `/api/metrics` and `/api/users` work, logout 204. Login page also rendered in the in-app browser. (No password was typed into the UI — that is left to you.)

## 4. Blockers found and how they were handled

| Finding | Handling |
|---|---|
| **Port 4000 is used by another project** (a `venueOS` API process, not this CRM). | Left untouched. CRM API runs on **4100** instead. |
| **Port 5173 already has a Vite dev server from this repo** (started 10:20 today, before this phase). It proxies `/api` to `127.0.0.1:4000` — i.e. to the *other* project's API. | Left untouched. **Do not log in through http://localhost:5173** — it will send requests to the venueOS API, not the CRM, and will not work. Use port 4100. |
| `vite.config.ts` hard-codes the proxy target `127.0.0.1:4000`, and changing it was out of scope (no code changes). | Worked around by serving the built frontend from the API on one port (production-style run). |
| `make`/`psql` missing. | Not needed: used Docker Compose + `npm run test:api:prep`, which migrates via Node. |
| Other containers on this machine (`venueos-*`, `redis7`, `bricketx-minio`, …). | Unrelated; not touched. The CRM DB uses its own container/volume/network (`functional_*`) and port 5434. |

## 5. Services started

| Service | Details |
|---|---|
| `convobrains-crm-test-db` (Docker) | Postgres 16, port 5434, volume `functional_crm_test_pg_data`, restarts unless stopped |
| CRM server (Node/tsx, background process) | `npx tsx server/index.ts`, port 4100, `NODE_ENV=production`; not auto-restarted — stops when the session/terminal ends |

## 6. Differences from the documented dev flow (`make dev`)

- Production mode instead of Vite hot-reload dev mode: Swagger docs off, secure cookies (fine on `localhost` in Chrome/Edge/Firefox), CSP enabled. Front-end code changes need `npm run build` + a server restart.
- No S3/AWS configured → **call recordings cannot be tested** (expected; documented as optional).
- First-admin creation was **not needed** here because the seed script provides a founder account. For a non-test database there is still no documented way to create the first admin (see `CRM_AUDIT.md` §19, S2) — not addressed in this phase.

## 7. Files created/changed by this phase

| Path | Status |
|---|---|
| `testing/functional/.env.testing` | new, git-ignored (copied from the shipped example; contains local test values only) |
| `dist/` | new build output, git-ignored |
| `LOCAL_SETUP_REPORT.md` | new (this file) |
| `package-lock.json` | still shows the **pre-existing** modification; not touched |
| Source files | none modified |

## 8. Manual steps still required / how to operate

**Open the app:** go to http://localhost:4100 and sign in as the founder (admin pages: Activity, Users, Settings are visible only to founder/admin; sign in as an SDR to compare views).

**Stop the server:** find and stop the process listening on 4100 (or end the session that started it):
```powershell
Get-NetTCPConnection -LocalPort 4100 -State Listen | Select-Object OwningProcess
```
then `Stop-Process -Id <that PID>`.

**Restart the server later (Git Bash, from the repo root):**
```bash
set -a && . ./testing/functional/.env.testing && set +a && PORT=4100 NODE_ENV=production npx tsx server/index.ts
```

**Stop the database (keeps data):**
```powershell
docker compose -f testing/functional/docker-compose.yml stop
```
**Reset to fresh demo data (⚠ wipes this local DB only):** `docker compose -f testing/functional/docker-compose.yml down -v`, then re-run `up -d` and `npm run test:api:prep`.

**To use the normal hot-reload dev mode** (`npm run dev`, UI on 5173): first free port 4000 (stop the venueOS API) and stop the existing Vite on 5173, then run `npm run dev` from Git Bash with the `.env.testing` variables loaded. This was deliberately not done here because those processes belong to other work.

**Ideas for the manual exploration (suggested checklist):** dashboard counters → drag a company across the Kanban → change a contact status as an SDR and watch the stage auto-move → Contacts queues/filters → Import Leads with a few rows → Activity page as founder (alerts, targets, export CSV) → Users (create a test user) → Settings (stages/statuses). Note that SDR-activity data is seeded for the past 3 days, so "today" will show only what you do yourself.
