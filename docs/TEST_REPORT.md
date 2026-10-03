# Test report

Run on 2026-10-03 against the local stack (Windows 11, Node 24.20, PostgreSQL 18.4 embedded, Next.js 16.3.8).
All numbers below are from actual runs, not expectations.

## Summary

| Check | Tool | Result |
|---|---|---|
| Type check | `tsc --noEmit` | **0 errors** |
| Lint | ESLint (Next 16 config, React hooks v6 rules) | **0 problems** |
| Unit + integration | Vitest + PGlite (in-memory PostgreSQL, real migrations) | **243 / 243 passed** (23 files) |
| End-to-end | Playwright (Chromium) | **30 / 30 passed** |
| Accessibility | axe-core (WCAG 2 A/AA, serious + critical) via Playwright | **0 violations** on 5 public pages and 9 signed-in modules |
| Accessibility | Lighthouse (desktop, homepage) | 96 → fixed the one finding (subtle-text contrast 3.76 → 5.69:1) |
| Best practices / SEO | Lighthouse (desktop, homepage) | 100 / 100 |
| Production build | `next build` | **succeeds**, 60 routes, no warnings |
| Secret scan | grep of `.next/static` client bundles | **0** matches for the session secret value, `postgres://`, `DATABASE_URL`, API-key names, `CRON_SECRET`, password hashes, demo password, `bcrypt` |
| Core Web Vitals | Chrome trace, production build, real GPU (AMD Radeon, DPR 1.25) | **LCP 555 ms, CLS 0.00** (homepage) |
| Mobile layout | Playwright iPhone 13 (390 × 844) | **0 px horizontal overflow** on 16 pages after fixes |

## Unit & integration (Vitest)

`npx vitest run` — 23 files / 243 tests, ~20–40 s. Integration tests create a fresh in-memory PostgreSQL (PGlite) and
apply the real SQL migrations from `drizzle/`.

| Area | Files | What is verified |
|---|---|---|
| Severity & model | `severity`, `baseline` | IMD-derived thresholds (plains/coastal/hills, departure and absolute criteria), spell length, persistence decay, NWP weighting, intervals, confidence heuristic |
| RBAC | `rbac` | path scoping, ancestor/sibling regions, module vs region checks, public role |
| Database | `schema` | all tables created, check constraints (country/parent, coordinates), partial unique index on open alerts, seed idempotency |
| Open-Meteo adapter | `open-meteo` | multi-location parsing, retry on 429/5xx with Retry-After, no retry on 4xx, network-error give-up, batching, cost estimate |
| Forecast pipeline | `forecast-run` | replay uses only as-issued NWP + history, 7-day output, verification vs reanalysis; live NWP ingestion + ingestion run; API outage → recorded failure, no invented data |
| Admin | `admin-users` | anti-escalation (seniority, out-of-scope regions, nationwide grants), scoped user lists, duplicate e-mail, self-deactivation and last-role guards |
| Advisories | `advisory-providers`, `advisory-workflow` | template output valid for all audiences/severities; Gemini/Claude adapters with mocked SDKs; fallback on missing key, error, timeout, invalid/ungrounded output; workflow transitions and permissions |
| Alerts & notifications | `alerts-engine`, `notifications-fanout` | severity/confidence/horizon thresholds, peak-day aggregation, dedup, cooldown, expiry; fan-out respects region scope and excludes the public role |
| Incidents | `incident-transitions`, `incidents-workflow` | workflow graph, resolution-summary rule, role permissions (field responders: own task status only) |
| Analytics & export | `analytics-metrics`, `analytics`, `csv`, `csv-exports` | MAE/RMSE/bias/band coverage/confusion matrix, heatwave-day counting, RFC 4180 escaping + formula-injection guard, scoped exports |
| Stations / IoT | `stations*` | payload validation, bearer-key auth, dedup, suspect detection, future/old timestamps |
| Landing | `landing-*` | globe sphere sampling, performance tiers, hero geometry |

## End-to-end (Playwright)

`npx playwright test` — 30 tests, ~3.3 min, against the running dev server.

- **Public:** landing (brand, tagline, Explore Dashboard → `/command`), signed-out redirect, public portal (live and replay, region page, IMD link, CLIMATIQ-generated label), methodology.
- **Auth & RBAC:** system admin sees all modules; field responder has no Admin/Analytics (server returns `/forbidden`); sign-out invalidates the session; demo reset refuses without the confirmation phrase; role switching changes permissions.
- **Workflows:** advisory generate → approve → publish (wrong-order `409`, traceability fields, UI tag); generation outside the assigned state `403`; scoped alerts + acknowledge (`409` on repeat); notifications read-all; public user `403` on alerts; incident lifecycle with task, note, transitions, `422` without resolution summary, close; field responder cannot create incidents; forecast CSV export (headers, units, provenance columns); response team cannot export; IoT ingestion rejects missing/invalid keys.
- **API:** health, region search, input validation (`400` envelope), cron auth.
- **Guided tour:** starts on first demo sign-in, advances, can be skipped.

## Accessibility

- axe-core scans of `/`, `/login`, `/portal`, `/portal/IN-RJ`, `/methodology`, `/command`, `/forecasts`,
  `/forecasts/IN-RJ-CHURU`, `/stations`, `/advisories`, `/response`, `/analytics`, `/admin`, `/settings` — **0 serious/critical
  violations** after fixes.
- Fixed during testing: prohibited `aria-label` on the intro wordmark; chart wrappers (`role="img"` → labelled group, as
  they contain focusable segments); severity bar segments (role for their labels); mis-nested `dt`/`dd`; low-contrast
  text on chart fills and heat-table cells (ramp capped so text keeps ≥ 4.5:1 in both themes); `--fg-subtle` darkened
  (3.76 → 5.69:1).
- Severity is always icon + text, never colour alone; the severity palette was re-tuned so Moderate (yellow) and High
  (orange-red) differ in lightness for colour-vision deficiencies; text uses dedicated `--sev-*-fg` tokens.
- Keyboard: skip link, visible focus, keyboard-operable search (Ctrl K), menus close on Esc, tour supports ←/→/Esc;
  maps have a "View as table" alternative; charts have "Show data table".
- `prefers-reduced-motion`: no scroll pinning, no globe auto-rotation, motion durations reduced globally.

## Security checks

- Server-side authorisation on every page (`requirePagePermission`), Server Action and API route (`authorize` /
  `requireApiUser` + region-scoped service checks) — exercised by the RBAC E2E tests and integration tests.
- `GET /api/v1/alerts` hardened during testing to require `alert:view` (previously returned an empty list to the public role).
- Sessions: HS256 JWT in http-only, `SameSite=Lax` cookies (Secure in production), 12 h expiry; roles re-read each request.
- Login rate limit (8/min/email), bcrypt password hashing, timing-equalised failed logins; demo login only when
  `DEMO_MODE=true` and only for `is_demo` accounts.
- Inputs validated with Zod at every boundary; uniform error envelope without stack traces.
- IoT keys stored as SHA-256 hashes, constant-time comparison, per-station and per-IP rate limits.
- CSV exports guard against spreadsheet formula injection.
- Security headers via `src/proxy.ts` (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`); `poweredByHeader` off.
- Client bundle secret scan: no secrets or server-only identifiers (see summary).
- Known limitation: the rate limiter is in-memory per instance (adequate for the MVP, not for multi-region scale-out).

## Performance

- **Homepage, production build, real GPU:** LCP 555 ms, CLS 0.00, steady 144 Hz frame pacing (median rAF 6.9 ms, p95 7.1 ms).
- **Globe optimisation** (after user feedback): pixel ratio capped (1.5 / 1.25 / 1 by tier), on-demand rendering —
  full rate only while spinning/dragging/scrolling, ~30 fps when idle (idle redraws dropped from every display refresh
  to ~29 per second, ≈ 5× less GPU work on a 144 Hz screen), shaders pre-compiled before the intro, intro starts only
  once geometry exists, adaptive-quality probe runs after warm-up (no mid-animation rebuilds), off-screen → no rendering.
- Server timings (production): `/portal` 0.18 s, `/methodology` 0.15 s, `/login` 0.07 s; homepage cold 1.2 s.
- Notes: `/analytics` computes heatwave frequency for 36 states live (~0.5 s, page ≈ 830 KB uncompressed) — a cache per
  data version is a sensible next step. The public portal inlines its SVG map (~400 KB uncompressed HTML, ~70 KB with
  compression).

## Not verified / known gaps
- Gemini and Claude providers were tested only with mocked SDKs (no API keys in this environment); the template
  provider carried the demo.
- No real IoT hardware; ingestion was tested with automated tests and invalid-key E2E checks (valid-key ingestion is
  covered by integration tests).
- Deployment to Vercel/Neon was prepared and documented but not executed (requires the user's accounts).
- Headless-browser screenshots use software WebGL; globe visuals were judged on the real GPU only for performance.
