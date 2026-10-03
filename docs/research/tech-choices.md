# CLIMATIQ: technology choices research

Researched on **2026-10-03**. Every claim cites the page it comes from. Prices and limits change often, so recheck them before the demo. Anything I could not verify is marked **UNVERIFIED** and listed in [section 8](#8-facts-i-could-not-verify).

Project baseline (from `package.json`): `next@16.3.8`, `react@19.2.8`, `motion@14`, `gsap@3.15`, `@react-three/fiber@9.8.1`, `@react-three/drei@10.7.9`, `maplibre-gl@6.11.2`, `react-map-gl@8.1.3`, `recharts@3.10.1`, `drizzle-orm@0.45.3`, `drizzle-kit@0.31.11`, `pg@8.23`, `@electric-sql/pglite@0.5.8`, `@google/genai@2.27.0`, `@anthropic-ai/sdk`. Local Node is v24.20.0 on Windows 11.

---

## Recommendations

| Area | Pick | Why (short) |
|---|---|---|
| **AI provider (default)** | **Google Gemini API free tier**, model `gemini-3.5-flash-lite` (switch to `gemini-3.8-flash` via an env var if quality is lacking), through `@google/genai` `models.generateContent` with `responseMimeType: "application/json"` + `responseJsonSchema` | Free input and output tokens. Native JSON-Schema structured output. Available in India. The 2.5 models are now restricted to existing users. |
| **AI fallback** | 1) **Groq free plan** `openai/gpt-oss-20b` with `response_format.json_schema` + `strict: true`; 2) a **deterministic rule-based advisory template**, so the demo never breaks. Anthropic `claude-haiku-4-5` is an optional *paid* fallback (no free tier). | Groq has strict constrained decoding on 3 free models. Template output can never fail. |
| **AI usage pattern** | Generate advisories in the **daily cron** (one call per city per day), store them in Postgres, and serve from the DB. Validate every response with Zod. Never send personal data. | Hobby cron is daily anyway. Free-tier prompts may be read by Google's human reviewers. |
| **Postgres** | **Neon via Vercel Marketplace** (Vercel-managed "Neon Postgres Native Integration"), **Free plan**, region **AWS Singapore `aws-ap-southeast-1`**. Pin Vercel Functions to **`sin1`**. | Free plan: 100 CU-h/project/month, 1 GB storage/project, scale-to-zero with sub-second wake. Env vars injected automatically. Optional DB branch per Preview deployment. |
| **DB driver** | Keep **`pg` (node-postgres) + `drizzle-orm/node-postgres`**. Use the **pooled** `DATABASE_URL` (`-pooler` host) and register the pool with `attachDatabasePool` from `@vercel/functions`. Use **`DATABASE_URL_UNPOOLED`** for migrations. | This is Vercel's documented Fluid-compute pattern and keeps the same driver for local Postgres. `@neondatabase/serverless` with `drizzle-orm/neon-http` is the alternative for one-shot HTTP queries. |
| **Migrations on Vercel** | Yes, run them at build time: `drizzle-kit migrate && next build` with `DATABASE_URL=$DATABASE_URL_UNPOOLED`. Env vars and devDependencies are both available during the Vercel build. | The build limit is 45 min. Hobby allows 1 concurrent build, so migrations cannot race. |
| **Hosting** | **Vercel Hobby** for the hackathon demo only | **Non-commercial only.** Cron at most once per day (±59 min). Functions max 300 s. **Cannot connect to Git repos owned by a GitHub organization**, so keep the repo under a personal account. |
| **Basemap** | **OpenFreeMap**. Light: `https://tiles.openfreemap.org/styles/positron`. Dark: `https://tiles.openfreemap.org/styles/dark`. | No key, no registration, no request limits, commercial use OK. Attribution is required, and there is no SLA. |
| **maplibre-gl v6 on Next/Turbopack** | Copy `maplibre-gl-worker.mjs` **and** `maplibre-gl-shared.mjs` to `public/maplibre/` from `predev`/`prebuild` scripts, and call `setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')` (official MapLibre docs). Keep `react-map-gl >= 8.1.2`. | Without this, under Turbopack the map mounts but **never requests tiles**. Plan B: pin `maplibre-gl@5.24.x`. |
| **Animation** | `motion` (import from `"motion/react"`). Rewrite `framer-motion` imports in 21st.dev components to `motion/react`. GSAP 3.15 + `@gsap/react` `useGSAP` is free, including SplitText and ScrollTrigger. | Avoids loading two copies of the motion runtime. GSAP is free for commercial use now. |
| **21st.dev components** | Use **stack-loader** (GSAP, Hyperiux licence) and **scroll-expansion-hero** (MIT) after installing them through the official CLI with your own 21st API key. Treat **elegant-dark-pattern** and **prisma-hero** as *inspiration only*: their licence is "unknown". | The 21st.dev registry now requires an API key (free: 2 code retrievals per day). See section 1. |

---

## 1. 21st.dev components

### 1.0 Access has changed: code retrieval needs an API key

- `https://21st.dev/r/<author>/<slug>` now returns **HTTP 403 `{"error":"Authentication required"}`** for all four components (tested 2026-10-03).
- Per https://21st.dev/llms.txt: the install command is `npx shadcn@latest add "https://21st.dev/r/<author>/<slug>?api_key=$API_KEY_21ST"`. Generate a key at https://21st.dev/mcp. A **free account gets "2 component code retrievals, copies, or installs per day total across Web, MCP, and CLI"**. Paid plans are unlimited. A `.md` view of each page (`…/components/<slug>.md`) shows metadata only.
- The 21st.dev Terms (https://21st.dev/terms, §2–3) say users may "view and use the content solely through the official 21st.dev platform", and they prohibit scraping and "attempting to circumvent any technical measures implemented to protect Marketplace content".
- Older code revisions are still reachable on `cdn.21st.dev` without auth, and a GitHub mirror (`sisodias/siso-component-bank`) harvested them that way. **I deliberately did not use or save those copies**, because doing so would bypass the gate above.
- **Result:** I saved the full source only for **stack-loader**, taken from the author's own public GitHub repo. The other three `.txt` files in `docs/research/21st/` contain metadata, the public usage API, the official install command and an integration checklist. Installing all three officially uses 2 days of free quota, or one day on a paid plan.

### 1.1 Comparison

| | scroll-expansion-hero | elegant-dark-pattern | stack-loader | prisma-hero |
|---|---|---|---|---|
| URL | https://21st.dev/@arunachalam/components/scroll-expansion-hero | https://21st.dev/@jatin-yadav05/components/elegant-dark-pattern | https://21st.dev/@hyperiux/components/stack-loader | https://21st.dev/@rahil1202/components/prisma-hero |
| Author | Arunachalam (@arunachalam) | Jatin Yadav (@jatin-yadav05) | Hyperiux Vault (@hyperiux) | Rahil Vahora (@rahil1202) |
| Licence (21st.dev) | **MIT** | **unknown** (empty) | MIT on 21st. Upstream says **Hyperiux Effects License v1.0** (see below) | **unknown** (empty) |
| npm deps | `next`, `framer-motion` | none | `gsap` | `framer-motion`, `lucide-react` |
| Published | 2025-05-06 (code updated 2026-09-07) | 2025-08-14 | 2026-09-18 | 2026-04-21 |
| What it does | A centered media card (video or image) that **expands to full-screen as you scroll**. A background image sits behind it, title/date text splits apart, and `children` are revealed after full expansion. Props from the demo: `mediaType`, `mediaSrc`, `posterSrc`, `bgImageSrc`, `title`, `date`, `scrollToExpand`, `textBlend`. | `<DarkGradientBg>` wrapper: a full-screen black background with layered gradients, masks and subtle texture. | Full-screen **intro loader**. Seven images stack, then spread out, and GSAP SplitText animates words in. It fades out to reveal the page. Props: `imageSize`, `duration`, `fadeOutDuration`, `backgroundColor`, plus `onComplete`/children in the 21st build. It respects `prefers-reduced-motion`. | Full-screen **cinematic hero**: a background video, animated word pull-up headline, a floating minimal navbar and a CTA. The demo is just `<PrismaHero />`, so the content is hard-coded. |
| Fit for Next 16 + React 19 + TW v4 | **Good** for the landing page. Swap the import to `motion/react`. Needs `"use client"`. If it uses `next/image` with remote URLs, configure `images.remotePatterns` or self-host. It scroll-jacks wheel/touch, so test mobile and reduced motion. | **Good**: CSS only, no animation libraries, can stay a Server Component if it has no hooks. **Licence risk**: re-create it rather than copy. | **Good** (verified in source): `"use client"`, gsap context cleanup, Tailwind v4 utilities (`z-99`, `max-[1025px]:`). Replace the remote R2 images and the hard-coded text. Show it only on first visit, because a full-screen loader delays LCP. | **OK** as inspiration. Swap the import to `motion/react` and make sure `"use client"` is present. Replace the hot-linked video and the copy. **Licence risk**. |

**stack-loader licence detail:** the upstream repo is https://github.com/Hyperiux-Immersion-Labs/hyperiux-components. Its `LICENSE` (MIT) covers only the CLI. The effects fall under `LICENSE_EFFECTS` (https://github.com/Hyperiux-Immersion-Labs/hyperiux-components/blob/main/LICENSE_EFFECTS), which allows use and modification inside your project (commercial OK, no attribution required). It **forbids publishing the effect as a standalone file or snippet** on a code-sharing site. **Add `docs/research/21st/` to `.gitignore`** if this repo becomes public. Official install: `npx hyperiux add stack-loader`. The upstream file differs from the gated 21st.dev build: its default export wraps its own demo UI and has no `children` prop.

**Alternative "stack loader":** Card Stack Loader by daiv09, https://21st.dev/@daiwiikharihar/components/card-stack-loader (MIT, `framer-motion` + `lucide-react`, neo-brutalist card stack, published 2026-08-03). It is also gated.

Saved files:
- `docs/research/21st/stack-loader.tsx.txt`: full upstream source with a provenance and licence header
- `docs/research/21st/scroll-expansion-hero.tsx.txt`, `elegant-dark-pattern.tsx.txt`, `prisma-hero.tsx.txt`: metadata, public API, install command and checklist (no source; reason above)

---

## 2. AI provider for structured heatwave advisories

### 2.1 Google Gemini API (recommended default)

**Models (2026-10-01 pricing page, https://ai.google.dev/gemini-api/docs/pricing):**

| Model ID | Free tier | Paid input / output per 1M tokens | Notes |
|---|---|---|---|
| `gemini-3.8-flash` | Free of charge (in/out) | $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50 | newest Flash |
| `gemini-3.5-flash-lite` | Free of charge | $0.30 / $2.50 | "fastest, most cost-effective 3.5 model" |
| `gemini-3.1-flash-lite` | Free of charge | $0.25 / $1.50 | cheapest paid text model |
| `gemini-2.5-flash` / `-flash-lite` | Free of charge | $0.30 / $2.50 and $0.10 / $0.40 | **Access is limited to users who already used 2.5. "For any new projects, use our latest models: 3.5 Flash-Lite or 3.8 Flash."** (https://ai.google.dev/gemini-api/docs/models) |

- Grounding with Google Search is **not available on the free tier** for 3.x models (pricing page).
- **Rate limits:** Google **no longer publishes free-tier RPM/TPM/RPD numbers**. Per https://ai.google.dev/gemini-api/docs/rate-limits (updated 2026-09-02), limits "can be viewed in Google AI Studio" (https://aistudio.google.com/rate-limit). Limits apply **per project, not per API key**, and RPD resets at midnight Pacific. "Specified rate limits are not guaranteed." Third-party sites quote roughly 15 RPM and 500–1,000 RPD for Flash-Lite (e.g. https://www.scriptbyai.com/gemini-api-free-tier-limits/), but they disagree with each other (**UNVERIFIED**). https://www.memetik.ai/guides/gemini-api-free-tier-limits confirms the numbers are not published.
- **Data use on the free tier** (https://ai.google.dev/gemini-api/terms, updated 2026-04-28): for "Unpaid Services", including the free API quota, Google "uses the content you submit … and any generated responses to provide, improve, and develop Google products". "Human reviewers may read, annotate, and process your API input and output". "Do not submit sensitive, confidential, or personal information". The paid tier is **not** used to improve products. The EEA, Switzerland and UK get paid-tier handling even on the free tier. Users must be 18+.
- **India:** listed in available regions (https://ai.google.dev/gemini-api/docs/available-regions).
- **SDK:** `@google/genai` (`npm install @google/genai`, https://ai.google.dev/gemini-api/docs/libraries). The latest is 2.27.0 (npm, 2026-10-02), which requires Node >= 20.
- **Two API surfaces.** Google now recommends the **Interactions API** (`client.interactions.create`) for new work, but "**generateContent remains fully supported**" (https://ai.google.dev/gemini-api/docs/migrate-to-interactions). The Interactions API stores state server-side by default (`store=true`), so set `store: false` for stateless calls. The docs disagree on whether `response_format` is an object (structured-output page) or an array (migration page). **Recommendation: use stateless `generateContent` for the hackathon.**
- **Structured output** (https://ai.google.dev/gemini-api/docs/structured-output, updated 2026-09-23): you pass a JSON Schema, and the SDKs accept Zod (JS) or Pydantic. Limitations: only a subset of JSON Schema is supported, and very large or deeply nested schemas may be rejected. `generateContent` takes `config.responseMimeType: "application/json"` with either `responseSchema` (OpenAPI-style `Type.*`, shown in the migration guide) or `responseJsonSchema` (plain JSON Schema; I confirmed the field exists in `@google/genai@2.27.0` `genai.d.ts`).

Minimal example (reference only; follows the official docs):

```ts
// server-only module
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const Advisory = z.object({
  riskLevel: z.enum(["low", "moderate", "high", "extreme"]),
  headline: z.string(),
  actions: z.array(z.string()).max(6),
  vulnerableGroups: z.array(z.string()),
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const res = await ai.models.generateContent({
  model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  contents: `Heat index 46°C, humidity 60%, city Nagpur. Write a public heat advisory.`,
  config: {
    responseMimeType: "application/json",
    responseJsonSchema: z.toJSONSchema(Advisory), // Zod 4
  },
});
const advisory = Advisory.parse(JSON.parse(res.text ?? "{}"));
```

Official Interactions-API form (from the structured-output page): `client.interactions.create({ model: "gemini-3.8-flash", input, response_format: { type: "text", mime_type: "application/json", schema } })`, then `JSON.parse(interaction.output_text)`.

### 2.2 Anthropic Claude API

- **No free tier.** The pricing FAQ says "New users receive a small amount of free credits to test the API" (https://platform.claude.com/docs/en/about-claude/pricing). New organisations may start in an "Evaluation tier" with reduced limits, and the Start tier has a $500/month spend cap (https://platform.claude.com/docs/en/api/rate-limits).
- **Cheapest current model:** **Claude Haiku 4.5, `claude-haiku-4-5`**, at **$1 / MTok input and $5 / MTok output** (Batch API: $0.50 / $2.50). Cache reads cost $0.10 / MTok. (Haiku 3.5 at $0.80/$4 is retired except on Bedrock and Google Cloud.) Source: same pricing page.
- **Structured outputs are GA** on current models, including `claude-haiku-4-5`, via `output_config: { format: { type: "json_schema", schema } }`. The TypeScript helper is `client.messages.parse({... output_config: { format: zodOutputFormat(Schema) } })`, imported from `"@anthropic-ai/sdk/helpers/zod"`, and the result is in `response.parsed_output`. Strict tool use (`strict: true`) is also available. Limits: no recursive schemas, no numeric or string-length constraints (the SDK moves them into descriptions or validates locally), at most 24 optional parameters (https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
- Verdict: excellent quality and the SDK is already installed, but it costs money. Use it only as a paid fallback.

### 2.3 Groq (free plan)

- Free-plan limits (https://console.groq.com/docs/rate-limits): `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `openai/gpt-oss-safeguard-20b` and `qwen/qwen3.8-27b` each get **30 RPM, 1K RPD, 8K TPM, 200K TPD**. Limits are per organisation, and cached tokens do not count.
- Structured outputs (https://console.groq.com/docs/structured-outputs): OpenAI-style `response_format: { type: "json_schema", json_schema: { strict: true, … } }`. **Strict mode (constrained decoding)** works only on `openai/gpt-oss-20b`, `openai/gpt-oss-120b` and `qwen/qwen3.8-27b`. Strict mode requires every field in `required` and `additionalProperties: false`. "Streaming and tool use are not currently supported with Structured Outputs."
- The 8K TPM cap is small but plenty for short advisories.

### 2.4 OpenRouter (free models)

- `:free` model variants are limited to **20 RPM**, **50 requests/day if you bought fewer than 10 credits**, and **1,000/day with 10+ credits**. A negative balance can produce 402 errors even on free models (https://openrouter.ai/docs/api-reference/limits).
- Structured outputs use `response_format: json_schema` + `strict`, and "are supported by select models". Set `require_parameters: true` so requests route only to endpoints that support it (https://openrouter.ai/docs/guides/features/structured-outputs).
- Training and logging policy for free endpoints depends on the provider (**UNVERIFIED** in detail).

### 2.5 Recommendation and fallback strategy

1. **Primary:** Gemini `gemini-3.5-flash-lite` on the free tier through `generateContent` + `responseJsonSchema`. Keep the model ID in `GEMINI_MODEL` so you can switch to `gemini-3.8-flash` without a code change.
2. **Validate** every response with Zod. On a parse error, retry once with a lower temperature.
3. **On 429 / 5xx / timeout:** fall back to Groq `openai/gpt-oss-20b` with a strict `json_schema` built from the same schema.
4. **Last resort:** a deterministic template driven by heat-index thresholds. Store `source: "gemini" | "groq" | "template"` with each advisory.
5. **Minimise calls:** generate once per city per day in the Vercel cron (daily on Hobby), store the result in Postgres, and render from the DB. Never send user PII. Only send public weather data, because free-tier prompts may be human-reviewed.

---

## 3. Managed PostgreSQL for Vercel

### 3.1 Neon (recommended): https://neon.com/docs/introduction/plans

**Free plan:**

| Limit | Value |
|---|---|
| Projects | 100 |
| Branches | 10 per project (no extra branches on Free) |
| Compute | **100 CU-hours per project per month** ("enough to run a 0.25 CU compute … for 400 hours/month") |
| Autoscaling | up to 2 CU (8 GB RAM) |
| Scale to zero | after 5 min of inactivity; **cannot be disabled on Free** |
| Storage | **1 GB per project, 20 GB account total** |
| Egress | 5 GB public network transfer per project |
| Restore window | 6 h, up to 1 GB |

- **Cold start:** after suspension, a compute "reactivates automatically within a few hundred milliseconds" on the next query (https://neon.com/docs/introduction/scale-to-zero).
- **Vercel Marketplace (Vercel-managed integration)** (https://neon.com/docs/guides/vercel-native-integration): billing runs through Vercel, and it creates the Neon project under an org named "Vercel: <team>". It injects:
  - `DATABASE_URL`: **pooled** (PgBouncer)
  - `DATABASE_URL_UNPOOLED`: direct
  - `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`
  - legacy `POSTGRES_*`
  - Optional **Preview Branching**: a database branch per Preview deployment. Its variables are injected at deployment time and are not visible in project settings.
  - It cannot be installed alongside the Neon-managed integration, or on a project still on deprecated Vercel Postgres.
- **Pooling** (https://neon.com/docs/connect/connection-pooling): add `-pooler` to the endpoint host. PgBouncer runs in **transaction mode** with up to 10,000 client connections, so SQL-level `PREPARE`, session `SET` and similar are not usable. Neon recommends **pooled for serverless functions and direct for schema migrations**.
- **Regions:** the closest to India is **AWS Asia Pacific (Singapore) `aws-ap-southeast-1`** (https://neon.com/docs/introduction/regions). Vercel has `sin1` (Singapore) and `bom1` (Mumbai) (https://vercel.com/docs/regions). Vercel Functions default to `iad1` (Washington DC), and **Hobby allows a single function region** (https://vercel.com/docs/functions/configuring-functions/region), so set it to `sin1` to sit next to the DB.
- **Branding note:** Neon's docs now describe the integration as adding a "**Lakebase** Postgres database". The product, URLs and env vars are still Neon.

**Driver choice for Neon:**
- **`pg` + `drizzle-orm/node-postgres` (recommended).** Vercel's guide (https://vercel.com/guides/connection-pooling-with-functions) recommends Fluid compute (the default for new projects). Create a `pg` `Pool` in module scope, call `attachDatabasePool(pool)` from `@vercel/functions` so idle connections close before the instance suspends, use a short idle timeout (about 5 s), and do not set max pool size to 1. Point it at the pooled `DATABASE_URL`. It works with the existing local Postgres and embedded-postgres setup unchanged.
- **`@neondatabase/serverless` (v1.2.0, Node >= 19)** (https://neon.com/docs/serverless/serverless-driver): it talks **HTTP** (fastest for one-shot queries; 64 MB request/response cap) or **WebSockets** (sessions and interactive transactions, node-postgres-compatible `Pool`/`Client`). With Drizzle you use `drizzle-orm/neon-http` or `neon-serverless` (https://neon.com/docs/guides/drizzle). It is useful on the Edge runtime, but not needed on Node functions. Implement retries for transient drops.

### 3.2 Supabase (free): https://supabase.com/pricing

- 500 MB database, shared CPU and 500 MB RAM, 5 GB egress, 1 GB file storage, 50k MAU.
- **"Free projects are paused after 1 week of inactivity. Limit of 2 active projects."**
- Serverless connections: use **Supavisor transaction mode, port 6543**, which "does not support prepared statements". Direct port-5432 connections are **IPv6-only** unless you buy the IPv4 add-on (https://supabase.com/docs/guides/database/connecting-to-postgres).
- Fine, but the auto-pause risk makes it worse for a demo that sits idle between judging rounds.

### 3.3 Prisma Postgres (free): https://www.prisma.io/pricing

- 200k operations per month (1 query = 1 operation), 500 MB storage, 50 databases.
- It supports standard drivers and ORMs (including Drizzle) through a **direct** TCP connection string, or through a serverless driver for short-lived runtimes (https://www.prisma.io/docs/postgres/database/direct-connections).
- The 200k-ops cap can be reached by polling dashboards.

### 3.4 Vercel Postgres

**Discontinued.** "Vercel Postgres is no longer available. If you had an existing Vercel Postgres database, we automatically moved it to Neon in December 2024. For new projects, install a Postgres integration from the Marketplace." (https://vercel.com/docs/postgres)

**Pick: Neon via the Vercel Marketplace (Free plan, Singapore).**

---

## 4. Vercel Hobby plan

- **Cron jobs** (https://vercel.com/docs/cron-jobs/usage-and-pricing):
  - 100 cron jobs per project on every plan.
  - **Hobby runs each job at most once per day.** Expressions such as `0 * * * *` **fail deployment** with "Hobby accounts are limited to daily cron jobs".
  - Timing precision is **per-hour (±59 min)**: `0 1 * * *` may fire any time between 01:00 and 01:59.
- **Function duration** (https://vercel.com/docs/functions/configuring-functions/duration, updated 2026-08-24): with Fluid compute (on by default), **Hobby defaults to 300 s and allows at most 300 s**. Projects created before 2025-04-23 without Fluid compute default to 10 s with a 60 s max (https://vercel.com/docs/limits).
- **Other Hobby limits** (https://vercel.com/docs/limits):
  - 100 deployments per day, 100 builds per hour
  - **1 concurrent build**
  - 45 min build time
  - runtime logs kept for only **1 hour**
  - **Hobby projects cannot connect to Git repositories owned by Git organizations**
- **Running `drizzle-kit migrate` at build time: feasible.** Environment variables can be read "during the Build Step or during Function execution" (https://vercel.com/docs/environment-variables). The install step includes devDependencies, so `drizzle-kit` is available (https://vercel.com/docs/builds/configure-a-build). Options:
  - Run it inside the build script: `drizzle-kit migrate && next build`. Use `DATABASE_URL_UNPOOLED`; the repo's `drizzle.config.ts` reads `DATABASE_URL`, so map the unpooled URL to it for the migrate step.
  - Or use the existing `scripts/db-setup.ts --migrate-only`.
  - Caveat: Preview builds will migrate whichever database the Preview environment points to. Enable Neon Preview Branching, or skip migrations when `VERCEL_ENV !== "production"`.
- **Non-commercial restriction** (https://vercel.com/docs/limits/fair-use-guidelines): "Hobby teams are restricted to non-commercial personal use only." This rules out payments, ads, selling products or services, being paid to build the site, and sites whose main purpose is affiliate links. Asking for donations is allowed. A hackathon demo is fine; anything monetised needs Pro.

---

## 5. Library compatibility

npm data is from `npm view` on 2026-10-03.

| Library | Latest | Status with Next 16.3 / React 19.2 | Notes |
|---|---|---|---|
| `@react-three/fiber` | 9.8.1 | **OK**. Peer `react >=19 <19.4`. | 9.8.0 added React 19.3 compatibility. 9.8.1 fixed `<Activity>` leaving a Canvas blank and renderer disposal on unmount (https://github.com/pmndrs/react-three-fiber/releases). Use >= 9.8.1. v10 is alpha (WebGPU/TSL), so avoid it. |
| `@react-three/drei` | 10.7.9 | **OK**. Peer `react ^19`, `@react-three/fiber ^9`, `three >=0.159`. | `three@0.186.1` is installed. |
| `maplibre-gl` | 6.11.2 (v6.0.0 on 2026-07-22) | **OK with setup** | v6 is **ESM-only** (`import * as maplibregl` or named imports, not a default import), **WebGL2 required**, `map.transform` removed, event types changed (https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md). **Next.js (Turbopack and `--webpack`) needs the worker and shared files copied to `public/` plus `setWorkerUrl`**, otherwise no tiles load (https://github.com/maplibre/maplibre-gl-js/blob/main/docs/index.md, "Turbopack" tab; issue https://github.com/maplibre/maplibre-gl-js/issues/8126). |
| `react-map-gl` | 8.1.3 | **OK**. Import from `react-map-gl/maplibre` (also published as `@vis.gl/react-maplibre`, peer `maplibre-gl >=4`). | **8.1.2 (2026-07-29) added "Support MapLibre GL JS v6"**. Earlier 8.x crashes with v6 (https://github.com/visgl/react-map-gl/issues/2597, https://github.com/visgl/react-map-gl/releases). |
| `recharts` | 3.10.1 | **OK**. Peer includes React ^19. | Install **`react-is` matching your React version** (README: "react-is needs to match the version of your installed react package", https://github.com/recharts/recharts). It is a client component. |
| `gsap` | 3.15.0 | **OK** | **Free under the "Standard 'No Charge' GSAP License", including all plugins (ScrollTrigger, SplitText, MorphSVG and the former Club plugins) and commercial use.** The only restriction is building no-code visual animation tools that compete with Webflow (https://gsap.com/licensing/). |
| `@gsap/react` | 2.1.2 | **OK**. Peer `gsap ^3.12.5`, `react >=17`. | `useGSAP(cb, { scope })` handles cleanup automatically via `gsap.context()`, and `contextSafe()` covers handlers. Call `gsap.registerPlugin(useGSAP)`. Files need `"use client"` (https://gsap.com/resources/React/). |
| `motion` | **14.0.0 (released 2026-10-02)** | **OK**. Peer `react ^18 \|\| ^19`. | `npm install motion`, `import { motion } from "motion/react"` (https://motion.dev/docs/react). v14 only removes internal APIs and pins the internal `framer-motion`/`motion-dom` versions. v13 removed the optional `@emotion/is-prop-valid` dependency (https://github.com/motiondivision/motion/blob/main/CHANGELOG.md). Rewrite `framer-motion` imports in 21st.dev code to `motion/react`. |
| `@electric-sql/pglite` + `drizzle-orm/pglite` | 0.5.8 / drizzle 0.45.3 | **OK for local dev and tests** | `drizzle(dataDir)` or `drizzle({ connection: { dataDir } })`, and drizzle-kit uses `driver: 'pglite'` (https://orm.drizzle.team/docs/connect-pglite). For Next.js, PGlite docs say to add the package to `transpilePackages` (https://pglite.dev/docs/bundler-support). Known issues: (a) **never open the same `dataDir` from two processes** (for example `next dev` and a drizzle-kit or seed script). It corrupts the data dir and causes `RuntimeError: Aborted()` (https://github.com/electric-sql/pglite/issues/884, open). (b) Data dirs created with 0.4.x need an upgrade for 0.5.x (https://github.com/electric-sql/pglite/issues/1019, https://pglite.dev/docs/upgrade). (c) The Windows terminal-popup bug was fixed in 0.3.10 (#770); `pglite-server --run` with `.cmd` on Windows is still open (#776). **No Node 24-specific issues found** in the tracker search. |
| `drizzle-orm` / `drizzle-kit` | 0.45.3 / 0.31.11 (npm `latest`) | **OK** | Drizzle's docs now show **v1 RC** installs (`drizzle-orm@rc`, `1.0.0-rc.4`). v1 has breaking changes: a new migrations folder layout without `journal.json` (run `drizzle-kit up`), relations v2, and DDL snapshots (https://orm.drizzle.team/docs/upgrade-v1). **Stay on 0.45.x for the hackathon**, and read docs carefully because examples may be v1-only. |
| `pg` | 8.23.1 | **OK** | Pair it with the pooled Neon URL and `attachDatabasePool` (section 3). |
| `@neondatabase/serverless` | 1.2.0 | OK (Node >= 19) | Only needed for Edge or HTTP one-shot queries (section 3). |

**Neon driver verdict:** use `pg` for Node runtime functions (Fluid compute) and `@neondatabase/serverless` only for Edge.

---

## 6. Free basemap tiles without an API key (MapLibre)

**OpenFreeMap (recommended)**, https://openfreemap.org/ and https://openfreemap.org/quick_start/:
- Style URLs (each returned HTTP 200 JSON on 2026-10-03):
  - **Light:** `https://tiles.openfreemap.org/styles/positron`
  - **Dark:** `https://tiles.openfreemap.org/styles/dark`
  - Others: `/styles/liberty`, `/styles/bright`, `/styles/fiord`, `/styles/3d`
- "There's no registration, no user database, no API keys, and no cookies". "No limits on the number of map views or requests". Commercial use: "Yes". MIT-licensed project, with OpenStreetMap data under ODbL.
- **Attribution:** "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (MapLibre's attribution control shows it from the style).
- **No SLA.** Have a fallback, such as a cached static image or a second style.

**CARTO basemaps** (`https://basemaps.cartocdn.com/gl/positron-gl-style/style.json` and `…/dark-matter-gl-style/style.json` still answer 200):
- The official repo now says **an API key is mandatory**: "free for non-commercial use up to 5M tile requests a month and for commercial use up to 1M a month"; above that you need a commercial plan (https://github.com/CartoDB/basemap-styles, terms at https://carto.com/legal/basemap-terms/).
- Not recommended without a key.

---

## 7. Quick-start checklist (no code written here)

1. Vercel: add Neon from the Marketplace with the Free plan in Singapore. Connect Development, Preview and Production. Set the function region to `sin1`.
2. Add `GEMINI_API_KEY` from AI Studio, plus optionally `GEMINI_MODEL` and `GROQ_API_KEY`.
3. Prefix the build with `drizzle-kit migrate` (unpooled URL), or run migrations manually before the demo.
4. Cron: one daily job (Hobby) for ingestion and advisory generation, with each function under 300 s.
5. maplibre v6: add the worker-copy `predev`/`prebuild` scripts and `setWorkerUrl` (see section 5).
6. 21st.dev: create a free API key and install stack-loader and scroll-expansion-hero through the official CLI. Change `framer-motion` imports to `motion/react`. Git-ignore `docs/research/21st/` if the repo is public.

---

## 8. Facts I could not verify

- Exact Gemini free-tier RPM, TPM and RPD per model. Google shows them only inside AI Studio, per project.
- OpenRouter's per-provider data-logging and training policy for `:free` endpoints.
- Full source of scroll-expansion-hero, elegant-dark-pattern and prisma-hero. It is gated behind a 21st API key and I intentionally did not bypass the gate. Their exact internal imports (`next/image`, `cn`, `"use client"`) should be checked after an official install.
- Whether Neon Preview-Branching env vars are available during the **build** step (Neon says "injected via webhook at deployment time"). Test this before relying on build-time migrations in Preview.
- Licence terms for elegant-dark-pattern and prisma-hero: 21st.dev lists them as "unknown".
