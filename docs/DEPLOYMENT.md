# Deployment guide — Vercel + managed PostgreSQL

CLIMATIQ is a standard Next.js 16 app plus PostgreSQL. The recommended target is **Vercel** with **Neon** (added
through the Vercel Marketplace). See `docs/research/tech-choices.md` §3–4 for the reasoning and current limits.

> Hobby (free) Vercel plans are for **non-commercial** use, allow **one cron job per day**, cap functions at 300 s and
> can't deploy repositories owned by a GitHub organisation. Neon Free sleeps after 5 min idle (cold start ≈ hundreds of
> ms) and has 100 compute-hours / month. Verify current pricing before relying on either.

## 1. Prerequisites
- A GitHub repository (personal account) containing this project.
- Node 20.19+ locally (Node 24 tested).
- A Vercel account; optionally the Vercel CLI (`npx vercel`).

## 2. Create the database
1. Vercel dashboard → your project → **Storage** → **Create** → **Neon (Serverless Postgres)** → region **Singapore
   (ap-southeast-1)**, plan **Free**. Connect it to the project for Production (and Preview if desired).
2. Vercel injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) automatically. CLIMATIQ uses the
   pooled URL at runtime and the direct URL for migrations.

Any other PostgreSQL 14+ works too (Supabase, Prisma Postgres, RDS…): set `DATABASE_URL` (and optionally
`DATABASE_URL_UNPOOLED`; `DATABASE_SSL=true` if the server needs TLS without a CA bundle).

## 3. Environment variables (Project → Settings → Environment Variables)

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | yes | from Neon integration (pooled) |
| `DATABASE_URL_UNPOOLED` | recommended | from Neon integration (direct) |
| `SESSION_SECRET` | yes | 64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DEMO_MODE` | yes | `true` for the hackathon demo (one-click accounts, auto-seed, reset); `false` otherwise |
| `APP_URL` | yes | your deployment URL, e.g. `https://climatiq.vercel.app` |
| `CRON_SECRET` | recommended | random string; Vercel Cron sends it as a bearer token |
| `AI_PROVIDER` | optional | `template` (default), `gemini` or `anthropic` |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | optional | key from Google AI Studio; default model `gemini-3.5-flash-lite` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | optional | Claude API key; default `claude-haiku-4-5` |
| `OPEN_METEO_API_KEY` | optional | only for paid Open-Meteo plans (also set the customer endpoint URLs) |

See `.env.example` for descriptions. Secrets are only read on the server; nothing is exposed with `NEXT_PUBLIC_`.

## 4. Build & migrations
`vercel.json` sets `buildCommand: npm run vercel-build`, which runs:

```
node --import tsx scripts/db-setup.ts   # applies drizzle/ SQL migrations; seeds demo data if DEMO_MODE=true and not yet seeded
next build
```

Seeding is idempotent (`seed_state` table) — redeploys never overwrite operational data. The first seed imports the
committed ERA5 snapshot (~270 k daily rows) and runs the replay and live forecast runs; allow 2–4 minutes.

To migrate manually instead: `DATABASE_URL=… npm run db:migrate`.

## 5. Cron
`vercel.json` schedules `GET /api/v1/cron/refresh` daily at 00:30 UTC (06:00 IST): recent ERA5 history, the live NWP
heat grid, a live forecast run (which raises alerts) and retention. It requires `CRON_SECRET`. Hobby plans may fire up
to ~59 minutes late. Admins can run the same jobs from **Administration → Ingestion**.

## 6. Region
`vercel.json` pins functions to `sin1` (Singapore) to sit next to the Neon database.

## 7. Deploy
```bash
npx vercel link          # once
npx vercel env pull      # optional: pull env for local preview builds
npx vercel --prod        # or push to the main branch with Git integration
```
Verify: `https://<app>/api/v1/health` → `{"status":"ok","db":"up",…}`; open `/login` and use a demo account.

## 8. Local development (one command)
```bash
npm install
npm run dev     # embedded PostgreSQL 18 (.data/pg, port 54330) + migrations + demo seed + Next on :3100
```
`.env.local` is created on first run with a random `SESSION_SECRET` and `DEMO_MODE=true`. To use an existing Postgres
instead, set `DATABASE_URL` in `.env.local` before running. No Docker is required.

## 9. Troubleshooting
| Symptom | Fix |
|---|---|
| `Invalid CLIMATIQ environment configuration` | a required variable is missing/short — compare with `.env.example` |
| Build fails at `db-setup` with connection errors | check `DATABASE_URL_UNPOOLED`; Neon may be waking up — redeploy |
| Live forecast shows "no run" | Open-Meteo unreachable or rate-limited; check Administration → Overview and retry the job later |
| Map tiles missing | OpenFreeMap unavailable — the map falls back to a plain background; data layers still render |
| `cron` returns 503 | `CRON_SECRET` not set |
| Port 3100 in use locally | `PORT=3200 npm run dev` |
| Embedded Postgres won't start | delete `.data/pg` (local demo data only) and rerun `npm run dev` |
