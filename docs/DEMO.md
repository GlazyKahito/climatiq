# Demo guide & presentation notes

Everything in the demo story is either **real data** (ERA5 reanalysis, Open-Meteo forecasts, real geography) or
**clearly labelled fiction** (people, teams, incidents, simulated stations). Say this out loud when presenting — it is
one of CLIMATIQ's core design principles.

## Setup (2 minutes)
1. `npm run dev` → wait for `✓ Ready` (first run seeds the database, ~2 min).
2. Open http://localhost:3100. The scenario switch in the top bar defaults to **Replay** in demo mode.
3. If the demo has been played with, sign in as the **System administrator** → Administration → Demo → type
   `RESET DEMO`.

## The story — "The late-May 2024 heatwave, replayed" (8–10 minutes)

| # | Where | What to show | Talking point |
|---|---|---|---|
| 1 | `/` | Scroll the hero; the globe's heat glyphs are real ERA5 maxima for 26 May 2024 | "Understand the Heat. Anticipate the Risk." Real data, not decoration. |
| 2 | `/login` | One-click **State administrator · Rajasthan** | Fictional accounts; role & region decide what you can see and do. |
| 3 | `/command` (Replay) | State choropleth → click **Rajasthan** → districts → **Churu** | Forecast issued as of 26 May 2024 using only what was known then (NWP *as issued*). |
| 4 | `/forecasts/IN-RJ-CHURU` | Uncertainty band, IMD-criteria severity, factors, duration, historical comparison | Severity mirrors IMD heatwave criteria but is labelled as a CLIMATIQ estimate; confidence is a heuristic. |
| 5 | `/advisories/new?region=IN-RJ-CHURU` | Generate for *Disaster-management teams*, preview, save draft | AI writes from a validated forecast bundle; template fallback if no key; nothing is invented. |
| 6 | `/advisories/<id>` | **Approve → Publish**; open "Inspect inputs" | Human-in-the-loop; full traceability (sources, model, prompt version, time). |
| 7 | `/advisories?tab=alerts` | Automated alerts from the run → **Create incident** | Dedup + confidence rules + cooldown; in-app notifications to the responsible team. |
| 8 | `/response` | Assign team/owner, add tasks, move status, see the timeline | Response coordination with audit trail. |
| 9 | Account menu | Switch to **Field response team · Jaipur** | Same app, fewer permissions, only Jaipur's tasks. Admin is hidden and blocked server-side. |
| 10 | `/analytics` (as analyst) | Forecast vs observed for the replay; heatwave frequency; CSV export | MAE ≈ 1.0–1.2 °C for days 1–6 vs ERA5 — one event, reanalysis truth, not validated skill. |
| 11 | `/stations` | SIMULATED stations; IoT ingestion API | No hardware yet — but the REST ingestion contract is real and authenticated. |
| 12 | `/portal` | Public outlook in plain language (switch to the replay) | What citizens see; official IMD warnings are linked, not imitated. |
| 13 | `/methodology` | Implemented vs approximated vs planned | Transparency: sources, limits, privacy. |

Then switch the top-bar scenario to **Live**: today's real forecast (in October the map is mostly Low — that's honest).

## Guided tour
Starts automatically on the first demo sign-in (except the public account); restart with the **?** button or from
Settings. It visits the command center, a forecast, advisories, alerts, response, analytics, stations, notifications and
the role switcher, skipping modules the current role cannot open.

## Q&A crib
- *Is this an official warning?* No — CLIMATIQ is decision support; IMD integration needs IMD approval.
- *Is the AI making up numbers?* No — the model only rewrites a validated bundle; sources are attached by the server;
  output is schema-validated; a deterministic template takes over if the AI fails.
- *How good is the forecast?* A transparent baseline; replay errors ≈ 1 °C for days 1–6 against ERA5. Not calibrated;
  the architecture allows ML models to be added and compared via model versions.
- *Where are the sensors?* None deployed; simulated stations demonstrate the dashboard and the ingestion API is ready.
- *Why these states?* IMD core heat-wave zone + plains, coastal and hill criteria (see `docs/DATA.md`).
