/**
 * Seed step `stations`: ~24 SIMULATED automatic weather stations in pilot districts with 7 days of hourly
 * simulated observations. No physical hardware exists — every station is `aws_simulated`, `is_simulated = true`,
 * sourced from `climatiq-simulator`, flagged `is_demo`, and every observation is `data_kind = 'simulated'`.
 * See src/server/stations/simulate.ts for how values are anchored to real district data where available.
 */
import { eq, inArray } from 'drizzle-orm';
import type { DB } from '../types';
import { dataSources, ingestionRuns, regions, seedState, stationObservations, weatherStations } from '../schema';
import { loadAnchorResolver } from '../../stations/anchors';
import { SOURCE_KEYS } from './reference';
import { hashSeed, hourlyTimeline, istDay, mulberry32, simulateStation, type AnchorBasis, type SimProfile } from '../../stations/simulate';

type PlanEntry = { district: string; n: number; behaviour: SimProfile['behaviour']; silentHours?: number };

/** 24 demo stations across the 7 pilot states (deterministic status mix: 16 online · 5 degraded · 3 offline). */
export const STATION_PLAN: PlanEntry[] = [
  { district: 'IN-RJ-JAIPUR', n: 1, behaviour: 'online' },
  { district: 'IN-RJ-JAIPUR', n: 2, behaviour: 'online' },
  { district: 'IN-RJ-JODHPUR', n: 1, behaviour: 'online' },
  { district: 'IN-RJ-BIKANER', n: 1, behaviour: 'degraded' },
  { district: 'IN-RJ-CHURU', n: 1, behaviour: 'online' },
  { district: 'IN-RJ-BARMER', n: 1, behaviour: 'offline', silentHours: 41 },
  { district: 'IN-UP-LUCKNOW', n: 1, behaviour: 'online' },
  { district: 'IN-UP-ALLAHABAD', n: 1, behaviour: 'online' },
  { district: 'IN-UP-JHANSI', n: 1, behaviour: 'degraded' },
  { district: 'IN-UP-AGRA', n: 1, behaviour: 'online' },
  { district: 'IN-UP-BANDA', n: 1, behaviour: 'offline', silentHours: 66 },
  { district: 'IN-MH-NAGPUR', n: 1, behaviour: 'online' },
  { district: 'IN-MH-CHANDRAPUR', n: 1, behaviour: 'online' },
  { district: 'IN-MH-AKOLA', n: 1, behaviour: 'degraded' },
  { district: 'IN-MH-MUMBAI', n: 1, behaviour: 'online' },
  { district: 'IN-OR-BALANGIR', n: 1, behaviour: 'online' },
  { district: 'IN-OR-SAMBALPUR', n: 1, behaviour: 'degraded' },
  { district: 'IN-OR-KHORDHA', n: 1, behaviour: 'online' },
  { district: 'IN-TG-ADILABAD', n: 1, behaviour: 'online' },
  { district: 'IN-TG-KHAMMAM', n: 1, behaviour: 'offline', silentHours: 30 },
  { district: 'IN-HP-UNA', n: 1, behaviour: 'online' },
  { district: 'IN-HP-SHIMLA', n: 1, behaviour: 'degraded' },
  { district: 'IN-DL-NEW-DELHI', n: 1, behaviour: 'online' },
  { district: 'IN-DL-NORTH-WEST', n: 1, behaviour: 'online' },
];

export const SIM_DAYS = 7;

export function simStationCode(district: string, n: number) {
  return `SIM-${district.replace(/^IN-/, '')}-${n}`;
}

/**
 * Seed-step entry point. Waits (step left pending) until the climate history step has run, so simulated values
 * can be anchored to real district data instead of the fallback curve.
 */
export async function seedStationsStep(db: DB): Promise<Record<string, unknown>> {
  const history = await db.select({ step: seedState.step }).from(seedState).where(eq(seedState.step, 'history')).limit(1);
  if (!history.length) return { incomplete: true, reason: 'waiting for the climate history step (station anchors)' };
  return seedStations(db);
}

export async function seedStations(db: DB, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [source] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, SOURCE_KEYS.simulator)).limit(1);
  if (!source) throw new Error('Data source climatiq-simulator missing — run the reference seed first');

  const codes = [...new Set(STATION_PLAN.map((p) => p.district))];
  const regionRows = await db
    .select({ id: regions.id, code: regions.code, name: regions.name, lat: regions.lat, lon: regions.lon, zone: regions.climateZone })
    .from(regions)
    .where(inArray(regions.code, codes));
  const byCode = new Map(regionRows.map((r) => [r.code, r]));

  const timeline = hourlyTimeline(now, SIM_DAYS);
  const firstDay = istDay(timeline[0]);
  const lastDay = istDay(timeline[timeline.length - 1]);

  const [run] = await db
    .insert(ingestionRuns)
    .values({ sourceId: source.id, job: 'station', status: 'running', triggeredBy: 'seed', startedAt: now, meta: { kind: 'simulated-demo-stations' } })
    .returning({ id: ingestionRuns.id });

  const basisCount: Record<AnchorBasis, number> = { daily_climate: 0, recent_persistence: 0, climate_normals: 0, climatology_curve: 0 };
  let stations = 0;
  let observations = 0;
  const skipped: string[] = [];

  for (const plan of STATION_PLAN) {
    const region = byCode.get(plan.district);
    if (!region) {
      skipped.push(plan.district);
      continue;
    }
    const code = simStationCode(plan.district, plan.n);
    const rng = mulberry32(hashSeed(`${code}:position`));
    const lat = Math.round((region.lat + (rng() - 0.5) * 0.12) * 10_000) / 10_000;
    const lon = Math.round((region.lon + (rng() - 0.5) * 0.12) * 10_000) / 10_000;

    const anchorFor = await loadAnchorResolver(db, { id: region.id, lat: region.lat, zone: region.zone }, firstDay, lastDay);
    const used = new Set<string>();
    const trackingAnchor = (day: string) => {
      const a = anchorFor(day);
      if (!used.has(day)) {
        used.add(day);
        basisCount[a.basis] += 1;
      }
      return a;
    };

    const obs = simulateStation({ code, lat: region.lat, zone: region.zone, behaviour: plan.behaviour, silentHours: plan.silentHours }, timeline, trackingAnchor);
    const lastSeenAt = obs.length ? obs[obs.length - 1].observedAt : null;

    const inserted = await db
      .insert(weatherStations)
      .values({
        code,
        name: `${region.name} AWS-S${plan.n} (simulated)`,
        regionId: region.id,
        lat,
        lon,
        elevationM: null, // not surveyed — there is no physical station
        stationType: 'aws_simulated',
        sourceId: source.id,
        status: plan.behaviour,
        isSimulated: true,
        sensors: ['temperature', 'humidity', 'wind', 'pressure'],
        apiKeyHash: null,
        lastSeenAt,
        isDemo: true,
      })
      .onConflictDoNothing({ target: weatherStations.code })
      .returning({ id: weatherStations.id });
    const stationId =
      inserted[0]?.id ?? (await db.select({ id: weatherStations.id }).from(weatherStations).where(eq(weatherStations.code, code)).limit(1))[0]?.id;
    if (!stationId) continue;
    if (inserted.length) stations += 1;

    for (let i = 0; i < obs.length; i += 500) {
      const chunk = obs.slice(i, i + 500).map((o) => ({
        stationId,
        observedAt: o.observedAt,
        tempC: o.tempC,
        humidityPct: o.humidityPct,
        windKmh: o.windKmh,
        pressureHpa: o.pressureHpa,
        dataKind: 'simulated' as const,
        quality: 'unverified' as const,
        ingestionRunId: run.id,
      }));
      const res = await db.insert(stationObservations).values(chunk).onConflictDoNothing().returning({ id: stationObservations.id });
      observations += res.length;
    }
  }

  const meta = {
    kind: 'simulated-demo-stations',
    window: { from: timeline[0]?.toISOString(), to: timeline[timeline.length - 1]?.toISOString() },
    anchorDays: basisCount,
    method:
      'Hourly diurnal curve (Tmin ≈ 06:00 IST, Tmax ≈ 15:00 IST) + seeded AR(1) noise, anchored per day to district daily_climate → recent persistence → climate_normals → documented demo climatology curve. Pressure is mean-sea-level-equivalent.',
    skippedDistricts: skipped,
  };
  await db
    .update(ingestionRuns)
    .set({ status: 'succeeded', finishedAt: new Date(), recordsIn: observations, recordsWritten: observations, meta })
    .where(eq(ingestionRuns.id, run.id));

  return { stations, observations, anchorDays: basisCount, skipped };
}
