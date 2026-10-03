# CLIMATIQ — Architecture & Implementation Plan

> **Understand the Heat. Anticipate the Risk.**
> CLIMATIQ is a hackathon-stage **decision-support** prototype for heatwave monitoring in India. It is **not** an
> official meteorological service; CLIMATIQ forecasts and advisories are always labelled as model-generated and are
> kept visually and structurally separate from official (IMD) warnings.

Status of this document: written before implementation (Phase 2) and kept up to date as decisions change. Research
notes backing the decisions live in [`docs/research/`](research/).

---

## 1. Workspace findings (Phase 1)

| Item | Finding |
|---|---|
| Existing code | None — the parent folder held only DBMS lab documents. A fresh project was scaffolded in `climatiq/`. |
| Toolchain | Node 24.20, npm 11.19, git 2.55, GitHub CLI 2.101, Vercel CLI 60. **No Docker.** |
| Framework | Next.js **16.3.8** (App Router, Turbopack), React 19.2, TypeScript 5, Tailwind CSS 4. Next 16 renames Middleware → **Proxy** (`src/proxy.ts`). Bundled docs in `node_modules/next/dist/docs/` are the reference. |
| Local PostgreSQL | A PostgreSQL 18 service exists on the machine but its credentials are unknown, so local dev uses **embedded-postgres** (real PostgreSQL 18 binaries started by `npm run dev`, data in `.data/pg`). Any `DATABASE_URL` overrides it. |
| Port | 3000 is occupied by another application → dev server runs on **3100**. |

## 2. System overview

```
                         ┌──────────────────────────── Next.js 16 (Vercel) ───────────────────────────┐
 Browser                 │                                                                            │
 ─────────               │  app/(marketing)  cinematic landing, features      ← GSAP + Motion + R3F    │
 Landing / Public portal │  app/portal       public climate portal (no login)                         │
 Command center (auth)   │  app/(app)/*      command, forecasts, stations, advisories, response,      │
                         │                   analytics, admin, settings       ← MapLibre + Recharts   │
                         │  app/api/v1/*     REST route handlers (JSON, zod-validated)                │
                         │        │                                                                   │
                         │  src/server/*   (server-only business logic)                               │
                         │   ├─ auth/        jose session cookie · DAL · RBAC (role × region scope)   │
                         │   ├─ forecasting/ model registry · baseline-v1 · severity · verification   │
                         │   ├─ ingestion/   adapters: open-meteo · imd (stub) · iot (REST) · sim      │
                         │   ├─ advisories/  provider abstraction: gemini · anthropic · template       │
                         │   ├─ alerts/      rules · dedup · cooldown → notifications (in-app channel)  │
                         │   ├─ incidents/   CRM workflow · tasks · activity                           │
                         │   ├─ analytics/   history · comparisons · accuracy · CSV                    │
                         │   └─ audit/       audit log · data corrections                              │
                         │        │ Drizzle ORM (node-postgres)                                       │
                         └────────┼───────────────────────────────────────────────────────────────────┘
                                  ▼
                     PostgreSQL 18 (local: embedded) / managed Postgres (prod)
                                  ▲
           Open-Meteo forecast + archive (ERA5) APIs — real data, no key ── ingestion runs
           IMD — adapter interface only (no permitted open API; see data-sources research)
           Future IoT stations — HTTP/REST ingestion endpoint with per-station API keys
```

### Key principles
1. **Provenance everywhere.** Every observation, forecast, metric and advisory carries a `data_kind`
   (`observed` · `reanalysis` · `nwp_forecast` · `model_forecast` · `simulated`) and a `source`. UI components render a
   `<Provenance>` badge; demo/simulated content is never silently mixed with real data.
2. **Business logic lives in `src/server`**, imported only by route handlers, server components and server actions
   (`import 'server-only'`). UI components receive plain data.
3. **Authorization is enforced on the server** (DAL + `requirePermission(perm, regionId)`); hidden UI is only cosmetic.
4. **Graceful degradation.** External APIs, the AI provider and WebGL can all fail without breaking the app
   (fallback advisory templates, cached last-good data with stale flags, SVG globe fallback).

## 3. Modules & routes

| # | Module | Route(s) | Access |
|---|---|---|---|
| 1 | Cinematic homepage | `/`, `/features` | public |
| 2 | Climate command center | `/command` | signed-in |
| 3 | Heatwave prediction | `/forecasts`, `/forecasts/[regionCode]` | signed-in |
| 4 | Weather stations | `/stations`, `/stations/[code]` | signed-in |
| 5 | Response CRM | `/response`, `/response/incidents/[ref]` | response roles |
| 6 | Advisories & alerts | `/advisories`, `/advisories/[id]`, `/alerts` | signed-in (generate/approve by role) |
| 7 | Climate analytics | `/analytics` | analyst+ |
| 8 | Public climate portal | `/portal`, `/portal/[regionCode]` | public |
| 9 | Administration | `/admin` | admins |
| 10 | Profile & settings | `/settings` | signed-in |
| 11 | Methodology & transparency | `/methodology` | public |
| — | Sign-in & demo access | `/login` | public |

REST API (versioned, JSON): `/api/v1/regions`, `/forecasts`, `/stations`, `/stations/{code}/observations` (IoT
ingestion, station API key), `/advisories`, `/alerts`, `/notifications`, `/incidents`, `/analytics/*`, `/export/*.csv`,
`/admin/ingestion`, `/admin/demo-reset`, `/health`. Documented in `docs/API.md`.

## 4. Geography

Hierarchy **India → State/UT → District → City/Locality** stored in `regions` (adjacency list + materialised `path`,
e.g. `IN/RJ/RJ-JAI/RJ-JAI-JAIPUR`). Boundaries are static GeoJSON in `public/geo/` (simplified for web), keyed by
region code; the database stores names, hierarchy, centroids, climate zone (plains / coastal / hilly → IMD criteria)
and pilot flags. All states/UTs exist; districts and cities are loaded for **pilot states** (chosen in research).
Every forecast stores its **resolution** (state centroid / district centroid / point) so the UI never implies
city-level precision from a coarser estimate.

## 5. Data & ingestion

* **Open-Meteo** (real, no key): daily forecast (NWP guidance, up to 16 days) and historical archive (ERA5 reanalysis,
  up to 5 years) for district/state centroids, requested in multi-location batches with retry + backoff + rate-limit
  awareness. Attribution shown in UI and docs.
* **IMD**: `ImdAdapter` interface implemented as *not configured* — no permitted open API was found (see research);
  setup instructions documented. Official warnings table stays empty unless a real, sourced warning is ingested, and the
  UI says so.
* **Stations**: no IoT hardware exists. Demo stations are **simulated** (flagged `is_simulated`); the REST ingestion
  endpoint for future IoT stations is real (per-station hashed API key, zod validation, plausibility checks, dedup on
  `(station_id, observed_at)`).
* **Ingestion runs** are recorded (`ingestion_runs`) with status, counts, errors, attempts → admin panel + freshness
  badges. Triggers: manual refresh (admin), app startup in demo mode if empty, and a daily Vercel Cron.
* **Offline fallback**: if Open-Meteo is unreachable during seeding, a deterministic simulator produces history that is
  stored with `data_kind = 'simulated'` and labelled everywhere.

## 6. Forecasting (`baseline-v1`)

A transparent statistical baseline, registered through a `ForecastModel` interface so ML models can be added later:

```
normal(d)      = 5-year day-of-year mean Tmax (±7-day window)          ← reference period, NOT an official 30-yr normal
anomaly0       = mean(Tmax[t-2..t]) − normal                             ← persistence of current anomaly
persistence(h) = normal(d+h) + anomaly0 · e^(−h/3)
prediction(h)  = w_h · NWP(h) + (1 − w_h) · persistence(h)               ← w_h = 0.85 → 0.55 as horizon grows; w=0 if no NWP
                 NWP: live = Open-Meteo forecast API; replay = Open-Meteo Previous Runs API (as issued, no hindsight)
σ(h)           = 0.9 + 0.3·h + 0.25·min(|NWP(h) − persistence(h)|, 6)   ← heuristic spread (+0.8 °C without NWP)
interval       = prediction ± 1.28σ  (nominal 80 % band, uncalibrated)
```

**Severity (CLIMATIQ 4-level scale, derived from IMD heatwave criteria — not an official IMD category):**

| Level | Rule (zone threshold T₀: plains 40 °C, coastal 37 °C, hills 30 °C) |
|---|---|
| Extreme | IMD *severe heatwave* criteria: Tmax ≥ T₀ and departure ≥ 6.5 °C, or (plains) Tmax ≥ 47 °C |
| High | IMD *heatwave* criteria: Tmax ≥ T₀ and departure 4.5–6.4 °C, or (plains) Tmax ≥ 45 °C |
| Moderate | Tmax ≥ T₀ and departure ≥ 2.5 °C (approaching heatwave) |
| Low | otherwise |

Thresholds live in `severity_thresholds` (configurable per climate zone, audited). Each forecast records predicted Tmax,
interval, NWP input, normal, departure, severity, confidence label + heuristic score (explicitly **not** a calibrated
probability), contributing factors, expected duration (consecutive days ≥ High), horizon, resolution, model version,
sources and generation time. Forecast runs are retained; **verification** joins forecasts with later observations
(MAE, RMSE, bias, severity hit/miss) — clearly marked when sample sizes are small or truth is reanalysis.

**Demo scenarios.** October has little heat risk, so besides *Live* (today's real data) the app ships a
**Historical replay: late-May 2024 North-India heatwave** built from real ERA5 reanalysis (via Open-Meteo archive) with
CLIMATIQ **hindcasts** — labelled as a replay, never as a current emergency. Incidents, teams and users are fictional.

## 7. AI advisories, alerts, notifications

* `AdvisoryProvider` interface → `GeminiProvider`, `AnthropicProvider`, `TemplateProvider` (deterministic, always
  available). Provider chosen by `AI_PROVIDER` env; failures fall back to the template provider and are logged.
* Input is a **validated forecast bundle** (zod); output must validate against the advisory schema (structured output);
  the prompt forbids inventing observations, sources or official warnings; source references are attached by the
  server, not by the model.
* Audience-specific variants: government, disaster-management, field teams, public.
* Workflow: generated → `draft` → approved/published by authorised roles (human-in-the-loop) → public portal shows only
  published public advisories.
* **Alerts**: rule engine on forecast runs (severity ≥ configured level, confidence ≥ minimum) with dedup key
  `(region, target_date, severity)`, cooldown, audit log. Alerts fan out to in-app notifications for users whose role +
  region scope matches. `NotificationChannel` interface; only `in_app` is implemented.

## 8. Response CRM

Incidents (`reported → triaged → in_progress → monitoring → resolved → closed`), priority P1–P4, region, team, owner,
due date, linked alert/advisory, tasks (`todo/in_progress/blocked/done`), activity timeline (status changes, notes,
assignments) and a dashboard (open incidents, overdue, priority mix, team workload, regional activity).

## 9. Auth & RBAC

* Email + password (bcrypt) with a signed **jose JWT** session cookie (httpOnly, sameSite=lax, secure in prod). The DAL
  re-loads the user, roles and region scopes on each request, so permission changes apply immediately.
* **Demo mode** (`DEMO_MODE=true`): `/login` offers one-click sign-in as seeded fictional users and a role switcher;
  disabled entirely when `DEMO_MODE` is not `true`.
* Roles: `system_admin`, `state_admin`, `district_admin`, `climate_analyst`, `disaster_official`, `response_team`,
  `field_responder`, `public`. Permissions are strings (e.g. `incident:update`) mapped via `role_permissions`;
  `user_roles` binds a role to a region scope (null = nationwide). `can(user, perm, regionId)` succeeds when an
  assignment grants `perm` on the region or one of its ancestors.

## 10. Database

PostgreSQL via **Drizzle ORM**; schema in `src/server/db/schema.ts`, generated SQL migrations in `drizzle/`
(committed, human-readable), applied by `npm run db:migrate` and automatically on dev start. Constraints, FKs,
check constraints and indexes on `(region_id, target_date)`, `(station_id, observed_at)`, `path`, statuses, etc.
Demo seed is **idempotent** (`seed_state` marker table) and only runs when the database is empty and `DEMO_MODE=true`;
demo records carry `is_demo` so **demo reset** deletes/re-creates only demo data.

Tables: users, roles, permissions, role_permissions, user_roles, regions, data_sources, weather_stations,
station_observations, daily_climate, climate_normals, ingestion_runs, model_versions, forecast_runs, forecasts,
forecast_verifications, severity_thresholds, official_warnings, advisories, advisory_regions, alerts, notifications,
teams, team_members, incidents, incident_tasks, incident_activities, audit_logs, data_corrections, app_config,
seed_state.

## 11. Front-end

* Tailwind v4 with design tokens (CSS variables) — a single theme of **sand ink `#EEE0C7`** on **wine-black
  `#22070E`** (`<html data-theme="dark">`), **Wine Red `#7F011F`** brand accent; severity palette always paired with
  text labels/icons.
* Fonts: futuristic display face (Orbitron/Space Grotesk family via `next/font`) + highly legible UI/body face + mono.
* Motion: **GSAP + ScrollTrigger** for the scroll-expansion hero and landing timelines; **Motion for React** for UI
  transitions. `prefers-reduced-motion` respected; a performance tier (WebGL support, hardware concurrency, device
  memory, FPS sampling) lowers globe detail and disables heavy effects.
* 3D globe: React Three Fiber, dotted land points generated from Natural Earth (world-atlas), India highlighted with
  heat glyphs; SVG fallback when WebGL is unavailable.
* Maps: MapLibre GL (react-map-gl) with GeoJSON choropleth, heat layer, station markers, drilldown and a basemap that
  falls back to plain background if tiles are unreachable; an accessible table alternative is provided.
* Charts: Recharts with units, legends and provenance labels.

## 12. Testing strategy

| Layer | Tooling | Scope |
|---|---|---|
| Unit | Vitest | severity classification, baseline model, confidence, dedup, RBAC `can()`, schema validators, CSV |
| Integration | Vitest + PGlite (in-process PostgreSQL) | migrations, constraints, seed idempotency, services, route handlers |
| E2E | Playwright (Chromium) | landing → dashboard, demo login & role switching, drilldown, advisory generate/approve, alert → notification, incident lifecycle, CSV export, demo reset, public portal |
| Accessibility | @axe-core/playwright | main pages, plus keyboard/focus checks |
| Security | scripted checks | secret leakage in client bundle, authz on every mutating route, demo mode off in prod |
| Performance | Lighthouse (chrome-devtools MCP) / Next build output | landing & command center |

## 13. Deployment

Vercel (Next.js) + managed PostgreSQL (provider chosen in research; pooled connection string). `vercel.json` cron for
daily ingestion. Migrations run via `npm run db:migrate` (build step or manual). `.env.example` documents every
variable. Local: `npm install && npm run dev` (starts embedded Postgres, migrates, seeds, launches Next on :3100).

## 14. Implementation order

1. Foundation — tokens/theme, DB schema + migrations, embedded Postgres dev script, auth/RBAC, app shell, shared UI.
2. Reference data + seed — geography, users/roles/teams, sources, stations, history (real or simulated), runs.
3. Parallel module build — landing/globe · map/command/stations · forecasting/analytics/ingestion ·
   advisories/alerts/notifications/CRM · portal/admin/settings/methodology.
4. Demo readiness — guided tour, replay scenario, demo reset.
5. Testing & refinement — run all suites, fix, accessibility/performance passes.
6. Docs & deployment prep — README, API docs, deployment guide, final report.
