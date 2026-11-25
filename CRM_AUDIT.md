# Zero Cost CRM — Codebase Audit

| | |
|---|---|
| **Repository** | `ConvoBrains/zero-cost-crm` (local clone, branch `main`, HEAD `99e9ca0`) |
| **Version** | `package.json` 1.1.0 · MIT licence · 116 commits, last commit 2026-11-02 |
| **Audit date** | 2026-11-25 |
| **Purpose of audit** | Decide whether this CRM is suitable for **internal, single-company** use. (Multi-tenant SaaS is out of scope.) |
| **Method** | Static reading of the source. No files were modified, nothing was installed, the app was **not run**, and the test suites were **not run**. The only commands executed were read-only (`git`, `grep`, `npm audit`, tool version checks). |

> **How to read the status labels used throughout**
> - ✅ **Implemented** — code exists on both server and UI and does what is claimed.
> - 🟡 **Partial** — works, but with a significant limitation or hard-coded assumption.
> - ❌ **Missing** — not in the code (or only in the README).

---

## 1. Executive summary

**What it really is.** Zero Cost CRM is a small, self-hosted **outbound-calling CRM for an SDR team**. Its core is a Kanban pipeline of *companies*, a call-queue of *contacts*, and — its main selling point — a **manager view that measures what each SDR did** (logins, active/idle time, calls, outcomes, targets). It is *not* a general-purpose CRM: there are no deals/opportunities as a separate object, no tasks, no email, no reports module, no per-user data ownership.

**Size and quality.** About 12,800 lines of TypeScript (React 19 + Express 5 + PostgreSQL). One API file (`server/app.ts`, 1,672 lines) holds most of the backend. Code is readable and consistently written. There are ~238 automated tests (unit, API, browser e2e) and a CI pipeline. Security basics (bcrypt, HttpOnly cookie, CSRF token, Helmet, login rate-limit, parameterised SQL) are present.

**Verdict for internal use: ⚠️ Conditionally suitable.**

| If your company… | Verdict |
|---|---|
| runs an **outbound cold-calling / SDR team of ~1–15 people** in **one timezone (India, IST)** and wants to see who is working | ✅ Good fit — this is exactly what it was built for |
| needs a **general CRM** (account management, tasks/reminders, email sync, quotes, reporting, multiple teams/territories) | ❌ Poor fit — most of that does not exist |
| needs **per-rep data privacy** (reps only see their own leads) | ❌ Not supported — every logged-in user sees and can edit every record |
| needs to **add/disable/delete users, reset passwords, change roles** from the UI | ❌ Not supported — create-user only |
| needs to **export** companies/contacts/deals | ❌ Not supported — only the *activity log* can be exported |

**Top blockers before any real rollout** (details in §19):
1. **No way to create the first admin user** outside of SQL (the only seed script is locked to a throw-away test DB and wipes other users).
2. **No user lifecycle**: no password change/reset, no deactivate, no role change.
3. **Timezone is hard-coded to IST** (`Asia/Kolkata`) in the activity engine and alerts; the dashboard and server "today" use UTC. Wrong results anywhere else.
4. **DB TLS is not verified** (`rejectUnauthorized: false`) despite docs saying "verified TLS".
5. **`npm audit`: 8 known advisories** (5 high, 3 moderate) in the current lockfile (6 affect production deps).
6. **Heavy ConvoBrains branding / promo** hard-coded into the sidebar and dashboard (cannot be removed from Settings).

---

## 2. Project architecture and folder structure

```text
zero-cost-crm/
├─ server/            Express 5 API (TypeScript, run with tsx — no compile step)
│  ├─ app.ts            ← almost all routes: auth, users, companies, contacts, import, metrics, settings
│  ├─ activityRoutes.ts ← manager analytics + CSV/JSON export + per-contact call log
│  ├─ activity.ts       ← sessions, idle maths, call-metric rules, alert rules
│  ├─ conversations.ts  ← call-recording upload/play/delete (S3)
│  ├─ s3.ts             ← AWS S3 helper (presigned PUT/GET)
│  ├─ settings.ts       ← instance settings (brand, stages, statuses) stored in DB
│  ├─ auth.ts           ← JWT, CSRF, role guards
│  ├─ config.ts         ← env parsing (fails closed in production)
│  ├─ db.ts, dbUrl.ts, loadEnv.ts, mappers.ts, stageBackfill.ts, activityFields.ts
├─ src/               React 19 SPA (Vite + Tailwind 4)
│  ├─ App.tsx           ← shell, page switching (no router library; uses ?page= query string)
│  ├─ components/       ← Dashboard, Pipeline, Contacts, ImportLeads, SdrActivity, Users, SettingsPage, forms
│  ├─ hooks/            ← useAuth, useCrmStore (all data in memory), useIdleSession, useAppConfig
│  └─ lib/              ← pure logic: views/filters, progress buckets, call log, import parser, stage auto-move
├─ sql/schema.sql     Single idempotent schema file (no numbered migrations)
├─ sql/examples/      Company-specific settings SQL (ConvoBrains' own statuses/questions)
├─ api/index.ts       Vercel serverless entry (re-exports the Express app)
├─ scripts/           db-migrate.mjs (needs `psql`), db-check.mjs, stage-auto-move-backfill.ts, local-against-live.sh
├─ testing/           unit/ (12 files), functional/api (11 files + seed scripts), e2e/ (14 Playwright specs)
├─ docs/              ARCHITECTURE.md, API.md, LOCAL_LIVE.md (internal ConvoBrains RDS runbook)
├─ openapi.yaml       OpenAPI 3.1 contract (served at /api/docs)
├─ Dockerfile, docker-compose.yml, vercel.json, Makefile, .github/workflows/ci.yml
```

**Runtime shape.** A **single-page app** talks to one **Express API** over JSON with cookie auth. The SPA loads *everything* (all companies + all contacts) in one `/api/bootstrap` call and keeps it in memory; filtering, sorting, search and the progress "insights" are all computed **in the browser**. In production Express also serves the built SPA from `dist/`.

---

## 3. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript ~6.0, Vite 8, Tailwind CSS 4, `@dnd-kit/core` (drag-and-drop), `exceljs` (reads `.xlsx` in the browser) |
| Backend | Node ≥ 22, Express 5, `pg` (raw SQL, **no ORM**), `bcrypt`, `jsonwebtoken`, `helmet`, `cors`, `express-rate-limit`, `cookie`, `swagger-ui-express`, `yaml` |
| Database | PostgreSQL 16 (`pgcrypto` extension for UUIDs) |
| File storage | AWS S3 (call recordings only) via `@aws-sdk/client-s3` + presigner |
| Tooling | oxlint, Prettier, Vitest 5, Playwright, `tsx`, `concurrently` |
| External requests from the browser | Google Fonts (DM Sans, Instrument Serif) from `fonts.googleapis.com` — see §16 |

---

## 4. Database schema

Source of truth: `sql/schema.sql`. All primary keys are UUIDs.

| Table | Purpose | Key columns / notes |
|---|---|---|
| `users` | Logins | `email` (unique), `password_hash` (bcrypt), `name`, `role` ∈ `founder | sdr | admin` |
| `companies` | **The pipeline "deal"** — one row per target company | `company_name` (unique, case-insensitive), `stage` (free text, validated in API), `industry`, `location`, `estimated_call_volume`, `employee_count`, `intent` (Hot/Warm/Cold), `offered_price`, `primary_contact_id`, `assigned_to`, `last_contacted`, `next_follow_up`, `notes`, `source_link`, `company_website`, `linkedin_company`, `discovery_answers` (JSONB) |
| `contacts` | People at companies | `company_id`, `role`, `phone`, `email` (unique, case-insensitive when present), `linkedin_profile`, `contact_status` (free text, validated in API), `champion` (bool), `last_contacted`, `next_follow_up`, `notes`, `whatsapp_sent_at` |
| `app_settings` | One-row instance config | brand name/tagline/logo, `stages[]`, `contact_statuses[]`, `champion_status_to_stage{}`, `discovery_questions[]`, `stage_auto_move_scope` |
| `lead_imports`, `lead_import_rows` | Import staging tables | **Defined but never written to** by the application code (see §20) |
| `conversations` | Call-recording metadata | `company_id`, `contact_id`, `called_by`, `stage_at_call`, `called_at`, `s3_url`, `file_ext`, `upload_status` (`pending|completed`), `notes` |
| `user_sessions` | One row per login session | `started_at`, `last_active_at`, `ended_at`, `end_reason` (`manual|idle|expired`); unique partial index = **one open session per user** |
| `activity_events` | **Append-only audit/activity log** — the data behind all manager analytics | `user_id`, `session_id`, `event_type`, `entity_type`, `entity_id`, `summary`, `payload` (JSONB) |
| `sdr_daily_targets` | Daily targets | calls 80 / follow-ups 25 / demos 4 (one effective row) |

**Relationships**

```text
users 1──* companies          (assigned_to; ON DELETE SET NULL)
users 1──* user_sessions      (CASCADE)
users 1──* activity_events    (CASCADE)
users 1──* conversations      (called_by)
companies 1──* contacts       (company_id; ON DELETE SET NULL)
companies 1──1 contacts       (primary_contact_id; ON DELETE SET NULL, circular FK added via DO-block)
companies 1──* conversations  (CASCADE)
contacts  1──* conversations  (CASCADE)
```

**Schema observations**
- **Stage and status are free text**, validated only in the API against `app_settings`. Renaming a stage in Settings does **not** migrate existing rows (they keep the old value).
- **"Deal" = company.** There is no separate opportunity/deal table, so one company = one deal; no multiple deals per account, no deal value history (only a single `offered_price`).
- `conversations.called_by` is declared `NOT NULL … ON DELETE SET NULL` — contradictory; deleting a user who has uploaded recordings would fail. (Moot today because users can't be deleted via the app.)
- Deleting a **user** cascades and **erases that user's activity history**.
- Deleting a company/contact cascades **recording rows** but the **S3 audio files are left behind** (orphaned).
- No migration framework: one idempotent file re-run on every upgrade. Fine for small installs, risky for breaking changes (documented as "describe upgrade steps in the PR").

---

## 5. Authentication and authorization

**How login works** (`server/app.ts:329`, `server/auth.ts`)
1. `POST /api/auth/login` with email + password → validates the email format (any domain is accepted), bcrypt-compares.
2. Creates a `user_sessions` row (closing any other open session for the same user) and logs a `session.login` event.
3. Issues a **12-hour JWT** in an **HttpOnly** cookie (`token`, `SameSite=Lax`, `Secure` in production) and a readable **CSRF cookie** (`csrfToken`). The JWT is *not* in the response body.
4. Every state-changing request must echo the CSRF cookie in an `X-CSRF-Token` header (double-submit, timing-safe compare).
5. The browser sends a heartbeat every 60 s; after **45 min of no mouse/keyboard activity** it logs the user out (2-minute warning banner).

**Limits of this design (verified in code)**
- `requireAuth` only checks the JWT signature. It does **not** check that the session is still open or that the user still exists. So the "idle logout" is a **UI/analytics feature, not a security control** — a stolen/old token keeps working for up to 12 h even after logout.
- Role is baked into the JWT at login; role changes (SQL-only) apply only after re-login.
- Login rate limit is **30 attempts / 15 min per IP**, with no per-account lockout.
- `app.set('trust proxy')` is **not set**. Behind Nginx/Vercel/a load balancer, all users may share one rate-limit bucket (and `express-rate-limit` will log warnings).
- No password change, no password reset, no MFA, no SSO.
- There is **no sign-up** endpoint — users are created by an admin (good), but see "first admin" gap in §19.

---

## 6. User roles and permissions

Three roles exist in the DB constraint: `founder`, `admin`, `sdr`. **`founder` and `admin` are identical in code** (`isAdminRole()` treats them the same). So effectively there are **two** permission levels.

| Capability | SDR | Admin / Founder |
|---|:--:|:--:|
| Log in, dashboard, pipeline, contacts, import | ✅ | ✅ |
| Create / edit **any** company or contact (not only their own) | ✅ | ✅ |
| Bulk-change contact status / WhatsApp flag | ✅ | ✅ |
| Import leads | ✅ | ✅ |
| Upload / list / play recordings (any contact) | ✅ | ✅ |
| View per-contact call log and company history | ✅ | ✅ |
| **Delete** company / contact / recording | ❌ | ✅ |
| View **SDR Activity** (analytics, alerts, timeline) | ❌ | ✅ |
| Export activity log (CSV/JSON) | ❌ | ✅ |
| Edit daily targets | ❌ | ✅ |
| **Create users** | ❌ | ✅ |
| Edit instance Settings (brand, stages, statuses, auto-move map) | ❌ | ✅ |

**Important absences:** no record-level ownership (everyone sees everything); `companies.assigned_to` is set to the creator and **never changeable** (no reassign UI/API); no teams, territories, field-level permissions, or custom roles. Admin-only pages are hidden in the UI *and* enforced by `requireAdmin` on the server (good — checked for every admin route).

---

## 7. Feature inventory (verified against code)

| # | Feature | Status | Evidence / notes |
|---|---|:--:|---|
| 1 | Login / logout / idle logout / heartbeat | ✅ | `app.ts:329-471`, `useIdleSession.ts` |
| 2 | Dashboard with counters + "follow-ups due today" | 🟡 | Works; global (not per-user); stage names hard-coded in `/api/metrics` |
| 3 | Company (pipeline) CRUD + Kanban drag-and-drop | ✅ | `Pipeline.tsx` (dnd-kit), `PATCH /api/companies/:id` |
| 4 | Contact CRUD, champion flag, notes, LinkedIn, follow-up date | ✅ | `Contacts.tsx`, `ContactForm.tsx` |
| 5 | Contact call queues (to-call-today, follow-up-today, overdue, didn't-pick-yesterday) | ✅ | `lib/views.ts` |
| 6 | Bulk contact status update / bulk WhatsApp-sent flag | ✅ | `app.ts:1080,1150` |
| 7 | Auto-move company stage from contact status | ✅ | `championSync.ts`, `autoMoveCompanyForContact` (forward-only, stops at "Demo Scheduled") |
| 8 | Calling-progress buckets & pipeline insights | ✅ | `lib/progress.ts`, `buildPipelineInsights` |
| 9 | Lead import — paste, `.csv`, `.xlsx` | 🟡 | Works; see §15 for caveats |
| 10 | Call-recording upload/playback (S3) | 🟡 | Works **only** with AWS configured; no local storage fallback |
| 11 | SDR activity analytics, sessions, alerts, targets | ✅ | `activityRoutes.ts`, `SdrActivity.tsx` |
| 12 | Per-contact dated call log; company history | ✅ | `/api/contacts/:id/call-log`, `/api/activity/company/:id/history` |
| 13 | Activity-log export (CSV/JSON) | ✅ | admin only |
| 14 | User creation | 🟡 | Create + list only |
| 15 | Instance settings UI (brand, stages, statuses, auto-move map & scope) | ✅ | `SettingsPage.tsx`, `ChampionMapEditor.tsx` |
| 16 | Discovery-question questionnaire on company form | 🟡 | Rendering works; **editing questions is API/SQL-only** (README says so honestly); empty by default |
| 17 | Swagger UI at `/api/docs` | ✅ | auto on in dev; `ENABLE_API_DOCS=true` in production |
| 18 | Tasks / reminders / calendar | ❌ | Only a `next_follow_up` **date** on company and contact |
| 19 | Email send/sync, templates, sequences | ❌ | None |
| 20 | WhatsApp integration | 🟡 | Only a manual "sent" flag + timestamp. No API, no `wa.me`/`tel:` links |
| 21 | Notifications / automation / webhooks | ❌ | None (see §13) |
| 22 | Reports module / charts / forecasting | ❌ | Counters only (see §12) |
| 23 | User edit / deactivate / delete / password reset | ❌ | None |
| 24 | Data export of companies/contacts | ❌ | None |
| 25 | Multi-tenant / multiple orgs | ❌ | Out of scope (single `app_settings` row) |

---

## 8. Dashboard (`Dashboard.tsx`, `GET /api/metrics`)

Shows: Total Companies, Total Contacts, Active Opportunities, Deals Won, Deals Lost; panels for New Leads, Follow-ups Due Today, Demo Scheduled, Active, Won, Lost; a list of companies whose `next_follow_up` is today; a static "daily CRM ritual" checklist; and a ConvoBrains promo block.

Limitations:
- **Global**, not per-user — an SDR cannot see "my follow-ups".
- The server counts by **hard-coded stage names** ("Lead Added", "Demo Scheduled", "Closed Won", …). If you rename stages in Settings, those tiles silently show zeros.
- "Follow-ups due today" uses **companies only** (not contact follow-ups) and **UTC date** (`toISOString().slice(0,10)`), so near midnight local time it can be off by a day.
- No **overdue** list on the dashboard (overdue exists as a Contacts queue).
- No charts or trends.

## 9. Lead and contact management

- **Companies** hold firmographics (industry, location, employee count, call volume, website, LinkedIn, source link), intent (Hot/Warm/Cold), offered price, notes, discovery answers, one primary contact and a next follow-up date.
- **Contacts** hold phone/email/LinkedIn/role, a **configurable status** (default 10, e.g. "Didn't Pick", "Connected – Future Follow-up", "Interested"), champion flag, follow-up date, notes, WhatsApp-sent timestamp.
- **Filtering:** Contacts page has search, queue, multi-status (current *or* ever-held), company, stage, champion-only, WhatsApp, date ranges; filter state is remembered per browser session. Pipeline has search with suggestions, saved views, date range, progress bucket.
- **De-duplication:** company name (case-insensitive) and contact email are unique at the DB level. A duplicate on manual create returns a generic **500 "Internal server error"** rather than a friendly 409 (import handles this properly).
- **Lead sources/lead scoring/lifecycle stages:** only a free-text `source_link` field; no scoring.
- Website/LinkedIn/phone/email are shown as **plain text** — no click-to-call, mailto, or "open website" links.

## 10. Sales pipeline and deal management

- **13 default stages** (Lead Added → Discovery Call Done → Follow-up → Demo Scheduled → Demo Delivered → Commercial Proposal Shared → POC Kickoff → Client Data Received → POC Delivered → Final Negotiation → Closed Won / Closed Lost / Not Interested). Stages are **editable in Settings** (add/remove/reorder).
- Kanban with drag-and-drop; every stage change is logged with who/when/from/to.
- **Auto-move rule:** when a contact's status changes (champion only, or any contact — configurable), the company is moved **forward only** to the mapped stage, and never once it reaches *Demo Scheduled* or later. Implemented in server + client + a one-off backfill script.
- **"Deal" data is thin:** one `offered_price` number (no currency, no probability, no expected close date, no products/line items, no forecast, no weighted pipeline value, no win/loss reason).
- Caveat: business rules reference **stage names as literal strings** (`Closed Won`, `Closed Lost`, `Demo Scheduled`, `Demo Delivered`, `Lead Added`), so heavy renaming will break dashboard counts, auto-move guards and progress buckets.

## 11. Follow-up and task management

- Follow-up = a **date field** on company and on contact. Setting/changing it is logged and counted in SDR metrics.
- Surfaces: dashboard "due today" (companies), Contacts queues (follow-up-today, overdue, didn't-pick-yesterday), card badge on the Kanban.
- **No task object**, no assignee, no due time, no recurring tasks, no reminders/email/push, no calendar view. Nothing alerts a rep that a follow-up is due unless they open the page.
- Manager alert "connected call(s) without follow-up" exists (see §13).

## 12. Team management and activity tracking — the strongest module

**Team management:** create user + list users (§6). Nothing else.

**Activity tracking (✅ well built):**
- Every meaningful action writes an `activity_events` row: login/logout/idle, create/update/delete of companies & contacts, status changes, follow-up changes, note changes, stage moves, WhatsApp flags, imports, recording uploads, and *record opens* (sent by the browser).
- **Active vs idle time** is *estimated* from gaps between events: a gap < 45 min counts as active, ≥ 45 min as idle.
- `SDR Activity` page (admin): per-SDR or whole-team view for a date range — login/logout, active/idle, calls made, connected, didn't-pick, wrong person, interested, follow-ups, demos, WhatsApp sent; progress bars vs daily targets; calls per hour; contacts/companies worked; a timeline with search; day activity strip; "By agent" table; CSV/JSON export.
- **"Calls made" is derived**, not measured: it counts *status changes to a call-outcome status* (plus recording uploads). There is **no telephony/dialer integration**, so numbers depend on reps updating statuses honestly.

**Reports & analytics:** no dedicated reports module — only the Activity page, Dashboard counters, and the Pipeline/Contacts "insights" panels. No funnel/conversion report, no revenue, no source analysis, no saved/exported reports (except the raw activity log).

## 13. Notifications and automation

| Item | Status |
|---|:--:|
| In-app **alerts** for managers (no login by 10:30, inactive 60 min, ≥30 calls with zero connects, connected calls without follow-up, targets incomplete at logout, ≥15 opens with no status change) | ✅ computed live, **shown only on the SDR Activity page** |
| Email / Slack / WhatsApp / push notifications | ❌ |
| Scheduled jobs / cron / background workers | ❌ (there are none; everything is request-time) |
| Webhooks / outbound integrations / Zapier | ❌ |
| Workflow automation | 🟡 only the stage auto-move rule |
| Alert thresholds configurable | ❌ — **hard-coded** (10:30 AM IST, 60 min, 30 calls, 15 opens) |

## 14. File uploads and call recordings

- Flow: browser asks `POST /api/conversations/presign` → gets a **presigned S3 PUT URL** (15 min) → uploads directly to S3 → `POST /:id/complete` verifies the object exists and ≤ 50 MB, copies staging → final key, records `called_at = now`, logs an event. Playback uses a **presigned GET URL (1 h)**.
- Allowed types: `mp3, m4a, wav, webm, ogg, mp4, aac`.
- **Requires** `AWS_ACCESS_KEY_ID/SECRET/REGION/S3_BUCKET`. Without them the feature simply errors (README calls S3 "optional" — it is optional to *run the app*, not a storage alternative). **No local-disk or MinIO/S3-compatible endpoint option** (no custom endpoint setting in `s3.ts`).
- Gaps: the 50 MB limit is checked **after** upload (the presigned URL does not cap size); abandoned `pending` rows are never cleaned up; **any logged-in user can play any recording**; recordings are not deleted from S3 when a company/contact is deleted; the S3 bucket CORS policy needed for browser uploads is **not documented**; no transcription/analysis (that is the paid ConvoBrains product advertised in the UI).
- Other uploads: only the lead-import file (parsed in the browser, never stored).

## 15. Import / export

**Import ✅/🟡** (`ImportLeads.tsx`, `importProspects.ts`, `POST /api/import/prospects`)
- Columns: Company · Prospect Name · Job Title · Email · Phone · Location · Employees · Industry. Paste (tab or CSV) or upload `.csv`/`.xlsx`; preview grouped by company; single-lead form; template download.
- Companies are matched by case-insensitive name (created or lightly updated); contacts de-duplicated by email (or by name within the company when there is no email); everything in **one transaction**; result counts shown.
- Caveats: file picker accepts `.xls` but the reader (`exceljs`) handles `.xlsx` only; the CSV **file** path uses a naive comma split (quoted commas break) whereas the paste path handles quotes; new companies always get stage **"Lead Added"** (hard-coded, not your first configured stage) and follow-up = today; industry is force-mapped into a fixed list (`BFSI, Healthcare, Retail, EdTech, Telecom, SaaS, Logistics, Research / Biotech, Other`) by keyword; email "cleaning" strips trailing `+digits`; the server does not validate row shape or cap row count (2 MB JSON body limit is the only bound); imported companies are auto-assigned to the importer.
- The staging tables `lead_imports` / `lead_import_rows` are **not used**.

**Export ❌/🟡:** only `GET /api/activity/export` (admin, CSV/JSON of the activity log). **No export of companies, contacts, pipeline or recordings.** CSV export does not neutralise spreadsheet formulas (`=`, `+`, `@` prefixes) in user-entered text. No database backup tooling is provided.

---

## 16. Environment variables and external dependencies

| Variable | Required | Purpose |
|---|:--:|---|
| `DATABASE_URL` (or `DB_URL_DEV`, which wins if set) | ✅ | Postgres connection string |
| `DB_SSL` | – | Set `false` for a non-TLS database. **Anything else = TLS on with certificate verification disabled** |
| `JWT_SECRET` | ✅ | Signing key (no minimum length enforced) |
| `NODE_ENV` | – | `production` enables secure cookies, CSP, static SPA serving |
| `PORT` | – | default 4000 |
| `CORS_ORIGINS` | – | Leave empty for same-origin production |
| `ENABLE_API_DOCS` | – | `true` to expose Swagger UI in production |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` | only for recordings | all four needed |
| `BRAND_NAME`, `BRAND_TAGLINE`, `BRAND_LOGO_URL` | – | one-time first-boot branding seed |
| `ALLOW_ACTIVITY_SEED` | test only | enables test JWT fallback & seed scripts — **never set in production** |

Env files are read from the **working directory**: `.env.local` then `.env` (process env wins). `testing/functional/.env.testing` is only read by test/seed scripts and the Makefile.

**External services contacted at runtime:** your Postgres; AWS S3 (if configured); **Google Fonts** (every page load — leaks visitor IPs to Google and fails styling on an offline/air-gapped network); outbound links to `convobrains.com`. No analytics/telemetry code was found.

## 17. Installation and local development

**Prerequisites:** Node ≥ 22 (this machine has v24.14 ✅), npm, Docker (✅ v29.8), and — for the documented path — **GNU `make` and a POSIX shell**.

**Documented path (Linux/macOS/WSL):**
```bash
make setup     # npm ci; start Docker Postgres on :5434; apply schema; seed demo users + data
make dev       # Vite on :5173 + API on :4000
```
Demo login: `founder.seed@convobrains.com` / `TestSeed123!` (founder). Seed also creates SDRs Rahul, Neha, Aman with the same password and 3 days of fake activity.

**On this Windows machine:** `make` ❌ and `psql` ❌ are **not installed**, so `make setup` / `make dev` and `npm run db:migrate` (which shells out to `psql`) will not work as-is. A no-`make` route exists because the seed script applies the schema through Node (`pg`), not `psql`:

1. `docker compose -f testing/functional/docker-compose.yml up -d` (Postgres 16 on port 5434)
2. `npm run test:api:prep` (copies the env example, applies the schema, seeds users/CRM/activity)
3. Start the app with the test env loaded into the shell (the app itself only auto-loads `.env.local` / `.env`, so either copy `testing/functional/.env.testing` to `.env.local` or export its variables), then `npm run dev`.

Also note `npm start` uses POSIX `NODE_ENV=production tsx …` syntax, which will not work in PowerShell/cmd (use Docker or set the variable first).

**Tests:** `npm test` (unit), `npm run test:api` (needs the DB), `npm run test:e2e` (Playwright). CI runs lint → unit → build, plus API and e2e jobs against a Postgres service. CI does **not** run `format:check` or `npm audit`.

> Note on your working tree: `git status` showed `package-lock.json` already modified *before* this audit — the diff only removes `"libc"` metadata lines (typical of a local `npm install` with a newer npm). It is unrelated to this audit and was left untouched. `node_modules` is already present.

## 18. Docker and deployment

- **Dockerfile** (multi-stage, `node:22-alpine`): builds the SPA, then a runtime image with prod deps + `tsx`, runs as a **non-root** user, healthcheck on `/api/health`, `CMD npx tsx server/index.ts`. (It runs TypeScript through `tsx` at runtime rather than compiling — works, slightly heavier.)
- **docker-compose.yml**: only the **app** container (port 4000, `env_file: .env`). **No Postgres service** — you must supply a database. The only Postgres compose file is the *test* one (`testing/functional/`), which is explicitly "never for production".
- **Vercel** (`vercel.json` + `api/index.ts`): serverless Express; pool limited to 2 connections. Works but a serverless deploy is a poor match for idle-timer/session tracking and for a Docker-only internal install.
- **Gaps for a production internal install:** no reverse-proxy/TLS config, no `trust proxy`, no first-admin bootstrap, no backup/restore script, no migration versioning, no log shipping. The `docs/LOCAL_LIVE.md` and `scripts/local-against-live.sh` are ConvoBrains' private RDS runbooks (SSH tunnel to *their* database) — **not relevant to you; do not run them**.

---

## 19. Security concerns and potential bugs

### 19.1 Security (ordered by importance for an internal deployment)

| # | Severity | Finding |
|---|:--:|---|
| S1 | 🔴 High | **Database TLS is not verified.** `server/db.ts`: unless `DB_SSL=false`, the pool uses `ssl: { rejectUnauthorized: false }` (encrypted but vulnerable to man-in-the-middle). README/SECURITY.md say to use "verified TLS". |
| S2 | 🔴 High | **No first-admin bootstrap and no user management.** Production DB starts with zero users; the only way in is hand-written SQL with a bcrypt hash. No password change/reset, no disable/delete. A departing employee's account **cannot be disabled** from the app, and their token stays valid up to 12 h. |
| S3 | 🟠 Med-High | **Sessions are not revocable server-side.** JWT validity is not tied to `user_sessions`; logout/idle only clears the cookie client-side. |
| S4 | 🟠 Med-High | **No per-record authorization.** Any authenticated SDR can read the *entire* customer base in one call (`/api/bootstrap`), edit any record, and play any recording. For internal use this may be acceptable; it is a data-leak risk if reps leave or you add contractors. |
| S5 | 🟠 Medium | **`npm audit`: 8 advisories (5 high, 3 moderate)**; production-relevant: `body-parser` (DoS), `brace-expansion` (DoS), `ip-address`, `qs`, and `exceljs`/`uuid` (moderate). Fixes are available. Dev-only: `vite`, `source-map-js`. (Not upgraded, per instructions.) |
| S6 | 🟠 Medium | **Rate-limit/proxy:** no `trust proxy`; behind a proxy all clients may share one limiter bucket, or the limiter can be bypassed via forged `X-Forwarded-For` depending on setup. No account lockout, no MFA. |
| S7 | 🟡 Low-Med | **JWT secret strength not enforced** (any non-empty string). A well-known test fallback secret is used if `JWT_SECRET` is missing and `NODE_ENV=test` or `ALLOW_ACTIVITY_SEED=1` (never in production, where a missing secret aborts startup). |
| S8 | 🟡 Low-Med | **Recordings:** presigned PUT has no server-side size/type cap; any user can play any recording; S3 bucket is expected to be private but nothing verifies it. |
| S9 | 🟡 Low | **CSV export formula injection** (cells beginning `= + - @`). |
| S10 | 🟡 Low | **Login user-enumeration by timing** (no bcrypt work for unknown emails); the "allowed domain" message is also public via `/api/config`. |
| S11 | 🟡 Low | **Docs mismatch:** `docs/API.md` says `Authorization: Bearer <jwt>` and login returns `{ token }` — the code uses cookies + CSRF and never returns a token. The `curl` example in `API.md` will not work. `openapi.yaml` is correct but is missing `POST /api/contacts/bulk-status`, `GET /api/activity/export`, `GET /api/contacts/:id/call-log`. |
| S12 | ℹ️ Info | Good practices confirmed: parameterised SQL everywhere (no string-built values; dynamic column names come from fixed code), bcrypt, HttpOnly + SameSite cookies, timing-safe CSRF compare, Helmet + CSP in production, admin guards on all admin routes, React escaping (no `dangerouslySetInnerHTML`, user URLs are never rendered as links), body limit 2 MB, fail-closed `JWT_SECRET` in production. |

### 19.2 Bugs and robustness issues

| # | Issue |
|---|---|
| B1 | **Hard-coded IST timezone** (`Asia/Kolkata`) and **10:30 AM** login deadline in `server/activity.ts`; day boundaries for analytics are IST. The dashboard/"today" use UTC. In any other timezone, "today" metrics and the "No login by 10:30" alert are wrong. |
| B2 | **Hard-coded business strings:** stage names in `/api/metrics`, `championSync`, `progress.ts`; status names (e.g. `Connected - Booked a Discovery Call`, `Wrong/Bad Number`, `Connected - DQ Prospect…`) in call-metric rules. Customising Settings can silently zero out counters. |
| B3 | **Duplicate/invalid input → HTTP 500.** Creating a company with a duplicate name, a contact with a duplicate email, a missing `companyName`, or a malformed UUID returns a generic 500 (only DB code `23514`/`42703` are mapped). Server-side validation of request bodies is minimal (types, lengths, emails, dates are largely trusted from the client). |
| B4 | **Non-atomic deletes.** Company/contact delete runs 2 separate statements (un-link, then delete) without a transaction; logging is best-effort on the shared pool. |
| B5 | **Scalability:** `/api/bootstrap` returns *all* companies and contacts (plus an aggregated history query over the whole activity log) on every page load; all filtering is client-side. Fine for thousands of rows; will degrade at tens/hundreds of thousands. `/api/activity/*` loads events into memory per request. |
| B6 | **Active/idle time is an estimate** from event gaps — a rep reading a long record without clicking shows as idle; leaving a page open doesn't count. Using it for performance or pay decisions is risky. |
| B7 | `assigned_to` is write-once; the UI shows "Assigned to" but offers no reassignment. |
| B8 | S3 files orphaned on company/contact delete; `pending` recordings never expire. |
| B9 | Importing with `.xls`, quoted-comma CSV files, or rows missing fields can fail or mis-parse (see §15). |
| B10 | The shared `conversations.called_by NOT NULL … SET NULL` contradiction (see §4). |
| B11 | Single large route file (`app.ts`, 1.7k lines) and no input-validation library (e.g. zod) — maintainability risk if you extend it. |

---

## 20. Documented but not (fully) implemented — README claims vs reality

| README / docs claim | Reality |
|---|---|
| "Live dashboard: Follow-ups due, demos, active opps, won/lost" | ✅ True, but global counters with hard-coded stage names (see §8). |
| "13-stage pipeline … drag deals" | ✅ True. |
| "Contacts: Champions, statuses, notes, LinkedIn" | ✅ True. |
| "Paste import: Excel / Sheets / CSV → deduped companies + contacts" | 🟡 True for paste & `.xlsx`; `.xls` and quoted-comma CSV files are weak. |
| "Call recordings: Upload & play audio per contact (**S3 optional**)" | 🟡 Only works *with* S3; "optional" means the feature is off without it. |
| "SDR activity: Logins, active/idle time, outcomes, targets" | ✅ True (active/idle is an estimate; timezone hard-coded to IST). |
| "**Manager alerts**: No login by 10:30, zero connects, missing follow-ups" | 🟡 Implemented as **on-screen** alerts on one page only — nothing is *sent* to anyone. Thresholds fixed in code. |
| "Roles: Founder / admin / SDR" | 🟡 Three names, **two** behaviours: founder = admin. |
| "Instance settings: Brand, stages, statuses, champion auto-move map" | ✅ True. (Discovery questions: API/SQL only — README is honest about this.) |
| "Self-hosted — your Postgres, your rules" | ✅ True. Docker image has **no bundled DB**. |
| "Follow-up discipline" | 🟡 Date fields + a manager alert. No reminders or tasks. |
| "One command to run" (`make setup && make dev`) | 🟡 True on Linux/macOS/WSL with Docker; **not** on plain Windows (no `make`, no `psql`). |
| "Use a … **verified TLS** for Postgres" (README) | ❌ Code disables certificate verification (S1). |
| `docs/API.md`: "requires `Authorization: Bearer <jwt>`", login returns `{ token }` | ❌ Outdated — cookie auth + CSRF header (S11). |
| `ARCHITECTURE.md` ER sketch / module table | Mostly accurate; omits the unused `lead_imports*` tables. |
| Tables `lead_imports`, `lead_import_rows` ("Daily import staging") | ❌ Created by schema, **never read or written** by any code. |
| `package.json` `description`: "follow-ups … lead imports" | Follow-ups = dates only (see §11). |
| Implicit: "not a vendor lock-in / MIT" | ✅ MIT, but the **ConvoBrains name/logo are trademarks** (`NOTICE`), and the UI hard-codes ConvoBrains promo blocks (sidebar, dashboard, recordings panel) that Settings cannot remove; default logo is ConvoBrains'. |

---

## 21. Suitability for internal company operations

### 21.1 What it does well
- Very focused **call-queue + pipeline** workflow with sensible daily rhythm.
- **Manager visibility into rep activity** is genuinely better than most free CRMs.
- Clean, readable, TypeScript-typed code; real test suite (≈238 tests) and CI; self-hosted; MIT.
- **Configurable** stages/statuses/branding without code changes; stage auto-move saves rep clicks.
- Small and easy to understand/modify (one Postgres, one Node process).

### 21.2 What it does not do
Tasks/reminders · email/telephony/WhatsApp integrations · notifications · reports & forecasting · deal objects (multiple deals per account, values, close dates) · record ownership & visibility rules · user lifecycle management · data export · SSO/MFA · multi-timezone · audit of *who viewed* data (only who changed it) · backups.

### 21.3 Recommendation

| Scenario | Recommendation |
|---|---|
| **Pilot for an outbound SDR/calling team (India-based, ≤ ~15 users)** | ✅ **Proceed**, after the "must-fix" list below. Low cost, fast to stand up. |
| **Company-wide CRM for sales + account management + support** | ❌ **Do not adopt as-is.** Treat it as a *starting codebase* at best; you would be building tasks, ownership, reporting, integrations yourself. |
| **Stepping stone to your own multi-tenant SaaS** | 🟡 Reusable ideas (activity log model, auto-move rules, settings-in-DB) but the single-file backend, free-text stages, singleton settings, and absence of tenant boundaries mean a **rewrite of the data layer** would be needed; do not build on `app.ts` directly. |

### 21.4 Suggested must-fix list *(recommendations only — nothing was implemented)*
1. Add a **first-admin bootstrap** script and **user management** (deactivate, reset password, change role). Add server-side revocation (check `user_sessions`/`users.active` in `requireAuth`).
2. Make **DB TLS verification** configurable (CA cert) and default to verified.
3. Set `trust proxy` appropriately; enforce a minimum `JWT_SECRET` length.
4. Make the **timezone, work-start time and alert thresholds configurable**; replace hard-coded stage/status literals with settings-driven values.
5. **Upgrade dependencies** flagged by `npm audit` (test afterwards).
6. Replace/disable the **Google Fonts** CDN if you need offline/privacy; remove or make optional the ConvoBrains promo components and logo.
7. Add proper request **validation** (return 400/409, not 500), transactions around deletes, and S3 clean-up.
8. Add a **data export** (companies/contacts) and a **backup** routine for Postgres.
9. Decide on **data-visibility rules** (per-rep ownership) if reps should not see each other's leads.
10. Document the **S3 bucket policy/CORS** if recordings are needed (or add S3-compatible endpoint support for MinIO).

---

## 22. Audit coverage and limitations (honesty note)

- **Read in full:** all of `server/`, `sql/schema.sql`, `package.json`, Dockerfile/compose/vercel/Makefile/CI, `.env.example`, `docs/*`, `SECURITY.md`, `CHANGELOG.md`, `App.tsx`, `Dashboard.tsx`, `Users.tsx`, `types.ts`, `defaults.ts`, `nav.ts`, `useAuth/useCrmStore/useIdleSession`, `api.ts`, `importProspects.ts`, `championSync.ts`.
- **Skimmed / searched (not line-by-line):** `Pipeline.tsx`, `Contacts.tsx`, `SdrActivity.tsx`, `SettingsPage.tsx`, `CompanyForm.tsx`, `ContactForm.tsx`, `ImportLeads.tsx` (first third read), `ConversationPanel.tsx` (first third), `lib/views.ts`, `lib/progress.ts`, test files and seed fixtures.
- **Not done:** the application was never started, no browser/UI checks, no tests executed, no live DB or S3 interaction, no penetration testing. Behaviour statements such as "`.xls` is not parsed" or "heavy renaming breaks counters" are derived from reading the code and should be confirmed in a pilot.
- `npm audit` results reflect the registry on 2026-11-25 and will change over time.
