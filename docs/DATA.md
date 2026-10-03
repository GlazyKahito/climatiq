# Data sources, provenance & licensing

Every value in CLIMATIQ carries a **data kind** and a **source**:

| `data_kind` | Meaning | Examples in CLIMATIQ |
|---|---|---|
| `observed` | Measured by a verified station/source | (none yet — no verified station network connected) |
| `reanalysis` | Model reconstruction of past weather | ERA5 via Open-Meteo archive (history, normals, replay truth, replay heat grid) |
| `nwp_forecast` | Third-party numerical weather prediction | Open-Meteo forecast API (live); Open-Meteo Previous Runs API (replay, as issued) |
| `model_forecast` | CLIMATIQ model output | `forecasts` table (baseline-v1) |
| `simulated` | Synthetic demo data | demo weather stations and their observations |

## Sources

| Source | Use | Access | Licence / attribution |
|---|---|---|---|
| Open-Meteo Forecast API | live NWP guidance per region and on the 1° heat grid | no key, ≤ 10 000 calls/day (non-commercial) | CC BY 4.0 — "Weather data by Open-Meteo.com" |
| Open-Meteo Historical Weather API (`models=era5`) | 5-year history, reference normals, replay truth | no key | CC BY 4.0; contains modified Copernicus Climate Change Service information |
| Open-Meteo Previous Runs API | replay NWP exactly as issued (no hindsight) | no key | CC BY 4.0 |
| IMD | official warnings | **not configured** — `api.imd.gov.in` requires registration + approval; legacy endpoints need IP whitelisting | link-out only (https://mausam.imd.gov.in) |
| geoBoundaries IND ADM1 | 36 states/UTs | committed, simplified TopoJSON | CC BY 2.5 IN (DataMeet); cite Runfola et al. 2020 |
| geoBoundaries IND ADM2 (2021) | 230 districts of 7 pilot states/UTs | committed, simplified TopoJSON | ODbL 1.0 (LGD / Pathways) |
| GeoNames cities15000 | 191 cities ≥ 100 k (plus capitals) in pilot states | committed JSON | CC BY 4.0 |
| Natural Earth (world-atlas) | globe land mask | npm package | public domain |
| OpenFreeMap | basemap tiles | no key | attribution required (OpenStreetMap contributors) |

Boundaries depict India's official claims at web scale but are **not authenticated by the Survey of India**, which the
2021 DST geospatial guidelines make the standard for political maps of India.

## Committed snapshot (real data)
`src/server/db/seed/data/snapshot/` holds a gzip JSON snapshot of real ERA5 data fetched on 2026-10-03 (≈ 4 765
weighted Open-Meteo calls) so the demo seeds quickly and works offline:

- `regions-era5.json.gz` — 266 regions (36 states + 230 districts): states continuously 2021-10-01 → 2026-09-27, plus
  Apr 20–Jun 30 of 2019/2020; districts: Apr 20–Jun 30 of 2019–2025, Sep 1–Nov 15 of 2022–2025, Aug 1–Sep 27 2026.
  2024 spring also includes apparent temperature, humidity, wind and radiation.
- `grid-replay-era5.json.gz` — 284 points (1° India grid), Tmax 2024-05-15 → 2024-06-05.
- `replay-nwp-previous-runs.json.gz` — 266 regions, 7-day Tmax guidance as issued before 2024-05-26.

Regenerate (respecting free-tier limits; responses are cached in `.data/snapshot-cache`):
```bash
node scripts/build-geo.mjs                       # boundaries & cities (inputs in .data/geo-src, see script header)
node --import tsx scripts/fetch-snapshot.ts      # ERA5 history + replay grid (~10 min, paced)
node --import tsx scripts/fetch-replay-nwp.ts    # as-issued NWP for the replay
```

## Runtime ingestion
`src/server/ingestion/runner.ts` — recent ERA5 history (last 21 days, ~5-day lag), live NWP heat grid, live forecast
run (fetches NWP per region and stores it as `nwp_forecast`), retention. Every job writes an `ingestion_runs` row
(status, counts, attempts, error). Triggers: daily cron, Administration → Ingestion, `npm run ingest -- <job>`.

## Reference normals
`climate_normals` rows have a `basis_key`:
- `era5-2019-2023` — used by the replay (years strictly before the 2024 event);
- `era5-2021-2025` — used by live runs.
Each is a day-of-year mean with a ±7-day window. These are **not** IMD's official 1991–2020 station normals.

## Pilot states
Rajasthan, Uttar Pradesh, Maharashtra (incl. Vidarbha), Odisha (coastal), Telangana, Himachal Pradesh (hills) and Delhi —
IMD core heat-wave zone states covering the plains, coastal and hill criteria (see `docs/research/data-sources.md` §4).
Telangana replaces Andhra Pradesh because the available AP district boundaries predate the 2022 reorganisation.
