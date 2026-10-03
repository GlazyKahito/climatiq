# CLIMATIQ REST API (v1)

Base path: `/api/v1`. JSON in, JSON out (CSV exports excepted). All mutating and most read endpoints require a signed-in
session (http-only `cq_session` cookie set by the sign-in page) — the same server-side role × region authorisation as
the UI applies. IoT ingestion uses per-station bearer keys instead. Server Actions used by the UI are not part of this
public API.

## Conventions

**Errors** — uniform envelope, never stack traces:

```json
{ "error": { "code": "invalid_request", "message": "Request validation failed", "details": [{ "path": "q", "message": "Too big" }] } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `invalid_request` | Zod validation failed / malformed JSON |
| 401 | `unauthenticated` | no or expired session / invalid station key / cron secret |
| 403 | `forbidden` | missing permission for the module or region |
| 404 | `not_found` | unknown resource |
| 409 | `conflict` | state conflict (e.g. duplicate, invalid workflow transition) |
| 413 | — | payload larger than the endpoint limit |
| 429 | `rate_limited` | per-client or per-station rate limit (fixed window, per server instance) |
| 500 | `internal_error` | unexpected server error (logged server-side) |
| 503 | `unavailable` | dependency not configured (e.g. `CRON_SECRET`) |

**Provenance** — climate payloads include `dataKind` (`observed` · `reanalysis` · `nwp_forecast` · `model_forecast` ·
`simulated`) and a source; CLIMATIQ output is never labelled official.

**Dates** — calendar days are `YYYY-MM-DD` (IST calendar); timestamps are ISO 8601 UTC.

## Platform

### `GET /api/v1/health`
Public. Liveness + freshness. `200 {"status":"ok","db":"up","latencyMs":3,"lastIngestion":{…},"lastForecastRun":{…}}`;
`503 {"status":"degraded","db":"down"}`.

### `GET /api/v1/regions`
Public geographic reference data (names, hierarchy, centroids — no operational data). Rate limit 120/min/client.

| Query | Effect |
|---|---|
| `q` (2–60 chars) | prefix search on names/codes → up to 12 matches with `parentName` |
| `parent=<code>` | children of a region |
| `level=state\|district\|city` (+ `pilot=true`) | list a level |

Region object: `{ id, code, name, level, parentId, path, lat, lon, climateZone, isPilot }`. Codes: `IN`, `IN-RJ`,
`IN-RJ-JAIPUR`, `IN-RJ-JAIPUR-C-JAIPUR`.

### `GET /api/v1/cron/refresh`
Daily scheduled ingestion (Vercel Cron). Requires `Authorization: Bearer $CRON_SECRET` (`503` when not configured,
`401` when wrong). Runs: recent ERA5 history → live NWP heat grid → live forecast run (+ alert evaluation) → retention.
Response `{ data: { jobs: [{ job, status, written, error? }], forecast: { runId, status, regions }, retention: {…} } }`.

### Authentication
Sign-in, demo sign-in, sign-out, theme and scenario switching are Server Actions (`src/app/actions/session.ts`), not
REST endpoints. Sessions are HS256 JWT cookies (12 h, http-only, `SameSite=Lax`, `Secure` in production); the user's
roles and regions are re-read from the database on every request. Login is rate-limited (8 attempts/min/email).

<!-- Module sections are appended below by each module. -->

## Forecasts, analytics & export

All endpoints in this section need a signed-in session. Forecast values are **CLIMATIQ model output** (`model_forecast`,
never official); severity is an IMD-criteria-based indicator, not an IMD declaration; `confidence.heuristicScore` is
**not** a probability; the forecast interval is a **nominal 80 % heuristic band (uncalibrated)**. Cities are not
forecast — they resolve to their parent district's forecast. `scenario` defaults to the caller's `cq_scenario` cookie
(`replay` = historical late-May 2024 hindcast, `live` = today).

### `GET /api/v1/forecasts?scenario=&day=&level=`
`dashboard:view` · 120/min/user. Latest successful run of the scenario; one target day (default: day 1).

| Param | Type | Notes |
|---|---|---|
| `scenario` | `live` \| `replay` | optional |
| `day` | `YYYY-MM-DD` | must be a target day of the run, otherwise `data: []` with a `meta.message` |
| `level` | `state` \| `district` | optional (default both) |

`200 { data: [{ region: { code, name, level, stateCode, stateName, climateZone }, targetDate, horizonDay, resolution,
predictedTmaxC, interval: { lowerC, upperC, nominal }, nwpTmaxC, normalTmaxC, departureC, severity, peakSeverity,
imdCriteriaCategory, confidence: { label, heuristicScore, isProbability: false }, durationDays }], meta: { scenario,
run: { id, issuedFor, horizonDays, isHindcast, status, model, generatedAt, inputs }, days, day, provenance, disclaimer } }`.
No run → `200 { data: [], meta: { run: null, message } }`.

### `GET /api/v1/forecasts/{code}?scenario=`
`dashboard:view`. Full horizon for any region code (case-insensitive). `data[]` adds `predictedTminC`, `factors[]`
(`{ key, label, value, impact: raises|lowers|neutral, detail }`) and `inputKinds`. `meta` carries `region`,
`forecastRegion` (the district for a city), `resolutionNote`, `run` (incl. `params.normalsBasis`). India (`IN`) returns
`data: []` — no national forecast exists; query states. Unknown code → `404`.

### `GET /api/v1/analytics/accuracy?run=&level=`
`analytics:view` · 60/min/user. Verification of a run (default: newest run with verifications) against ERA5 reanalysis.
`data`: `overall {n, mae, rmse, bias, maxAbs}` (°C; bias = predicted − truth), `bandCoverage {inside, n, rate}`,
`byHorizon[]`, `byLevel[]`, `byRegion[]` (sorted by MAE), `byModel[]`, `confusion { matrix[pred][obs] (low→extreme),
exact, exactRate, withinOne, event { hits, misses, falseAlarms, correctNegatives, pod, far, csi } }` (event = ≥ High),
`runs`, `observedKinds`, `regions`. `meta.caveats` lists the limits (reanalysis truth, single event, spatial correlation).

### `GET /api/v1/analytics/heatwave-days?regions=IN-RJ,IN-UP&from=&to=&scenario=`
`analytics:view`. Up to 40 region codes. Per region and calendar year: `daysEvaluated`, `moderate`, `high`, `extreme`,
`heatwaveDays` (= High + Extreme) and `maxTmaxC`, from ERA5 daily Tmax classified with `classify()` (thresholds from
`severity_thresholds`) against the scenario's reference normal (`replay` → `era5-2019-2023`, `live` → `era5-2021-2025`;
regions without it fall back to their widest basis). `meta.unknownRegions`, `meta.method`, `meta.caveat`.

### `GET /api/v1/analytics/history?region=&from=&to=`
`analytics:view`. Daily climate history (≤ 3,700 days) as JSON: `day, tmaxC, tminC, apparentTmaxC, rhMeanPct,
windMaxKmh, radiationMj, dataKind, sourceKey, sourceName, updatedAt`. NWP guidance rows are never returned as history.

### CSV exports — `GET /api/v1/export/*.csv`
`analytics:export` · 20/min/user · audited (`export.*`). RFC 4180: CRLF records, header row, fields quoted when they
contain `,` `"` CR/LF or edge spaces, `""` escaping, UTF-8. Text cells beginning with `= + - @` are prefixed with `'`
(spreadsheet-formula guard; numeric cells are untouched). Units are in column names (`_c` °C, `_pct` %, `_kmh` km/h,
`_mj_m2` MJ/m²); timestamps ISO 8601 UTC; every row carries `data_kind` and `source`. Responses use
`Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="climatiq_…csv"`.

| Endpoint | Rows | Key columns |
|---|---|---|
| `forecasts.csv?run=<uuid>` | every forecast of the run within the caller's region scope | `run_id, model_version, scenario, is_hindcast, issued_for, run_generated_at, region_code, region_name, level, parent_code, climate_zone, lat, lon, resolution, target_date, horizon_day, predicted_tmax_c, lower_c, upper_c, interval_note, predicted_tmin_c, nwp_tmax_c, normal_tmax_c, normal_basis, departure_c, severity, imd_criteria_category, confidence, confidence_score, confidence_note, duration_days_ge_high, input_kinds, data_kind, source, official, exported_at` |
| `history.csv?region=<code>&from=&to=` | daily history (≤ 3,700 days); `analytics:export` must cover that region | `region_code, region_name, level, lat, lon, day, tmax_c, tmin_c, apparent_tmax_c, rh_mean_pct, wind_max_kmh, radiation_mj_m2, data_kind, source, record_updated_at, exported_at` |
| `verification.csv?run=<uuid>` | forecast/truth pairs within the caller's scope | `run_id, model_version, scenario, is_hindcast, issued_for, region_code, region_name, level, target_date, horizon_day, predicted_tmax_c, lower_c, upper_c, observed_tmax_c, observed_kind, truth_source, error_c, abs_error_c, within_band, predicted_severity, observed_severity, severity_exact_match, evaluated_at, exported_at` |

Errors: invalid UUID/date/range → `400`; unknown run/region → `404`; missing permission (or region outside the
caller's scope for `history.csv`) → `403`.

**UI action (not public API):** "Run live forecast now" on `/forecasts` is a Server Action (`forecast:run`, 3 per
5 min per user) that calls `runForecast(db, { scenario: 'live', triggeredBy: 'user:<id>' })`, audits
`forecast.run_requested` and revalidates `/forecasts` and `/command`.

## Advisories, alerts, notifications & incidents

All endpoints require a session. Lists are filtered server-side by the caller's role × region scope; mutations check
the permission on the record's region (`can(user, perm, regionPath)` — the assignment's region or an ancestor).
Unauthorised → `403 forbidden`; invalid workflow transitions → `409`/`422` with a readable `message`. Successful
responses use `{ data, meta? }`. Every mutation is written to `audit_logs`.

### Advisories (AI-assisted, human-approved)

| Method & path | Permission | Notes |
|---|---|---|
| `GET /advisories` | signed in | Query: `status` (`draft\|approved\|published\|archived\|all`), `audience` (`government\|disaster_mgmt\|field_team\|public`), `severity`, `region` (code; matches the region and everything below it), `scenario` (`live\|replay`), `limit` ≤ 200, `offset`. Published `public` advisories are visible to everyone; all others need `advisory:view_internal` on a region that overlaps the advisory's regions. |
| `POST /advisories` | `advisory:generate` on **every** region | Body `{ regionCodes: string[1..12], audience, runId?, scenario?, dryRun? }`. Builds a validated forecast bundle from the run (default: latest run of `scenario`, else the session scenario), generates content with the configured provider and stores a **draft** (`201` + `Location`). `dryRun: true` returns the preview without storing. 10 req/min/user. |
| `GET /advisories/{id}` | visibility as above | Full advisory: content, regions, validity, confidence, `sourceRefs`, `provider`, `modelName`, `promptVersion`, `fallbackReason`, generation/approval/publication metadata, the exact input `bundle`, history and the caller's allowed `actions`. |
| `POST /advisories/{id}/approve` · `/publish` · `/archive` | `advisory:approve` on every region | `draft → approved → published`; any non-archived → `archived`. A generator may archive (discard) their own draft. Wrong order → `409`. Publishing notifies `advisory:view_internal` holders of those regions. |

**Generation pipeline.** `AI_PROVIDER` = `gemini` (`GEMINI_API_KEY`, `GEMINI_MODEL`; `models.generateContent` with
`responseMimeType: application/json` + `responseJsonSchema`) · `anthropic` (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
default `claude-haiku-4-5`; `messages.parse` with a Zod `output_config.format`) · `template` (deterministic, default).
The provider only receives the Zod-validated **forecast bundle** (`forecast-bundle-v1`: run metadata incl.
scenario/hindcast flag, per-region daily Tmax + band, normal, departure, severity, IMD-criteria flag, confidence label +
score, spell, factors, resolution, data sources with kinds, official-warning count). Output must pass the
`AdvisoryContent` Zod schema **and** grounding checks (no °C value absent from the bundle; no claim of an official
warning when none exists). Missing key, provider error, ~20 s timeout or invalid output → deterministic template, with
`fallbackReason` stored. Mandatory limitations (CLIMATIQ-generated, not an IMD warning; replay notice; reference
normals; resolution) are always enforced; `sourceRefs` are attached by the server, never by the model. The input bundle
is kept in the `advisory.generate` audit record ("Inspect inputs" in the UI).

### Alerts (automated)

| Method & path | Permission | Notes |
|---|---|---|
| `GET /alerts` | `alert:view` (scoped) | Query: `status` (`open` default = active + acknowledged, `active`, `acknowledged`, `resolved`, `expired`, `all`), `severity`, `region`, `scenario` (`live\|replay\|all`), `limit`, `offset`. Items include region, target date, heuristic confidence, linked incident refs and `scenario`. |
| `GET /alerts/{id}` | `alert:view` on the region | Alert + source forecast (Tmax, band, normal, departure, factors), rule snapshot, linked incidents/advisory. |
| `POST /alerts/{id}/acknowledge` | `alert:acknowledge` on the region | `active → acknowledged` (else `409`). |
| `POST /alerts/{id}/resolve` | `alert:manage` on the region | Body `{ note? }`. `active\|acknowledged → resolved`; starts the cooldown. |
| `POST /alerts/evaluate` | nationwide `alert:manage` | Body `{ runId }`. Re-runs the rules on a run (idempotent). Returns `{ created, skipped, expired, notified }`. 6 req/min. |

**Rules** (`src/server/alerts/rules.ts`, thresholds from `app_config`): a forecast qualifies when severity ≥
`alerts.min_severity` (default `high`), heuristic confidence ≥ `alerts.min_confidence` (0.45) and
1 ≤ horizon day ≤ `alerts.max_horizon_days` (5). Qualifying rows are aggregated to **one alert per region per run, at the
peak day** (highest severity, then Tmax, then earliest date). Pilot districts raise district-level alerts; a state
raises a state-level alert only when the run has no district forecasts for it. Dedup key
`${scenario}:${regionCode}:${targetDate}:${severity}` (unique among open alerts); a resolved alert with the same key
blocks re-alerting for `alerts.cooldown_hours` (24). Open alerts of the same scenario whose target day precedes the new
run's issue date are expired. Each new alert is audited and fanned out as in-app notifications (one per user per alert)
to active users holding `alert:view` with a scope equal to or above the region (never the `public` role). The forecast
pipeline calls `evaluateAlerts(db, runId)` after every run.

### Notifications (in-app channel only)

| Method & path | Notes |
|---|---|
| `GET /notifications` | The caller's notifications, newest first. Query: `status` (`all\|unread\|read`), `severity`, `kind` (`alert\|advisory\|incident\|system`), `region`, `limit`, `offset`. `meta: { total, unread }`. |
| `POST /notifications/read` | Body `{ all: true }` or `{ ids: uuid[1..200], unread?: true }`. Only the caller's notifications change. Returns `{ unread }`. |

`NotificationChannel` (`src/server/notifications/channels.ts`) is the extension point; only `InAppChannel` exists — no
e-mail or SMS is sent.

### Incidents (response CRM)

| Method & path | Permission | Notes |
|---|---|---|
| `GET /incidents` | `incident:view` (scoped) | Query: `status` (`active` default, `all`, or a status), `priority`, `severity`, `region`, `teamId`, `mine=true`, `overdue=true`, `q`, `limit`, `offset`. |
| `POST /incidents` | `incident:create` on the region (+ `incident:assign` when `teamId`/`ownerId` given) | Body `{ title, description, regionCode, severity, priority, alertId?, advisoryId?, teamId?, ownerId?, dueAt? }` → `201 { id, ref }` (`INC-YYYY-NNNN`). |
| `GET /incidents/dashboard` | `incident:view` | Totals, status/priority/state distribution, team workload, overdue incidents & tasks, P1/P2 list, recent activity — all scoped. |
| `GET /incidents/{ref}` | `incident:view` on the region | Detail with tasks, activity timeline, linked alert/advisory, the caller's permissions and allowed transitions. |
| `PATCH /incidents/{ref}` | `incident:update` (fields) / `incident:assign` (`teamId`, `ownerId`) | Body `{ title?, description?, priority?, severity?, dueAt?, teamId?, ownerId? }`. Teams must cover the region; owners need `incident:update` there. Assignees are notified in-app. |
| `POST /incidents/{ref}/transition` | `incident:update`; `incident:close` to resolve, close or reopen | Body `{ to, resolutionSummary?, note? }`. Flow `reported → triaged → in_progress ⇄ monitoring → resolved → closed`; any active state → `resolved`; `resolved\|closed → in_progress` (reopen). Resolving/closing needs a summary of at least 10 characters (`422`; also a DB check constraint). |
| `POST /incidents/{ref}/notes` | `incident:update`, or `task:update` for users with a task on the incident | Body `{ body }`. |
| `GET\|POST /incidents/{ref}/tasks` | POST: `task:update` + `incident:update` | Body `{ title, priority?, assigneeId?, dueAt? }`; assignees need `task:update` on the region and are notified. |
| `PATCH\|DELETE /incidents/{ref}/tasks/{taskId}` | `task:update` | Managers (`incident:update`) may change anything or delete; field responders may change only the **status** of tasks assigned to them. |

Every incident change adds an activity entry (`created`, `status_change`, `note`, `assignment`, `task`, `link`,
`update`) and an audit record. Demo incidents (`is_demo`) are fictional and say so in their description.

## Stations, map data & IoT ingestion

No physical stations are deployed. Demo stations are `aws_simulated` (`isSimulated: true`) and every response about them
says so. Real IoT stations are registered in the UI (`/stations/register`, `station:manage`, region-scoped); the API key is
shown **once** and only its SHA-256 hash is stored.

### `POST /api/v1/stations/{code}/observations` — IoT ingestion
Auth: `Authorization: Bearer <station API key>` (constant-time hash comparison). Rate limits: 240/min per client IP and
60/min per station. Body ≤ 512 KB: a single observation or `{ "observations": [ … ] }` (1–500).

```json
{ "observedAt": "2026-05-26T14:00:00+05:30", "tempC": 46.2, "humidityPct": 18, "windKmh": 9.5, "pressureHpa": 998.4 }
```

| Field | Rule |
|---|---|
| `observedAt` | ISO 8601 with offset; > 10 min in the future → rejected `future_timestamp`; older than 30 days → `too_old` |
| `tempC` (required), `humidityPct`, `windKmh`, `pressureHpa` | hard limits (temp −60…65 °C, RH 0…100 %, wind 0…400 km/h, pressure 300…1100 hPa) → rejected `out_of_range` |
| plausibility | outside soft limits for India or a sudden jump vs the neighbouring observation (≤ 2 h apart: ΔT > 8 °C, ΔRH > 50 %, Δp > 6 hPa) → stored with quality `suspect` |
| duplicates | same `(station, observedAt)` is ignored (counted in `duplicates`) |

Stored observations get quality `unverified` (or `suspect`) — never auto-`verified`. Each request records an
`ingestion_runs` row (source `iot-gateway`, `triggeredBy: iot:<code>`) and updates the station's `last_seen_at`/status.

`200 { data: { station, ingestionRunId, received, accepted, duplicates, suspect: [{ index, observedAt, flags }], rejected: [{ index, reason, detail }] } }`.
Malformed payload → `400`; bad/missing key → `401`; nothing acceptable → `422` with the rejection list; too large → `413`;
rate limited → `429`.

### `GET /api/v1/stations?status=&type=&state=`
`station:view`. Station registry with effective status (`online` · `degraded` · `offline` · `planned`, derived from data
freshness), location, region, `isSimulated` and the latest observation.

### `GET /api/v1/stations/{code}/observations?from=&to=&limit=`
`station:view` · 120/min/user. Dates or ISO timestamps (IST calendar for plain dates); default last 7 days; range ≤ 31 days;
`limit` ≤ 5000 (default 1000), newest first. `meta` includes the station summary, `truncated`, and a provenance note
(SIMULATED vs IoT-unverified).

### Map data (command center) — signed-in, `dashboard:view`
| Endpoint | Returns |
|---|---|
| `GET /api/v1/map/forecasts?level=state\|district&parent=<code>` | all target days of the latest run of the caller's scenario, shaped for choropleths |
| `GET /api/v1/map/grid?day=YYYY-MM-DD` | heat-layer cells `{ lat, lon, tmaxC }` with `kind` (`reanalysis` / `nwp_forecast` / `simulated`) and source; empty `points` when no grid exists |
| `GET /api/v1/map/regions/{code}` | side-panel detail: forecast series (cities resolve to their district) and a district's cities |
