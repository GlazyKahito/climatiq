/**
 * IoT observation ingestion (DB side). Used by POST /api/v1/stations/{code}/observations.
 * Driver-agnostic: takes a DB so it can be exercised against PGlite in tests.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '../db/types';
import { auditLogs, dataSources, ingestionRuns, stationObservations, weatherStations } from '../db/schema';
import { HttpError } from '../http';
import { SOURCE_KEYS } from '../db/seed/reference';
import { assessBatch, JUMP_WINDOW_MS, parseBearer, parseObservationPayload, verifyStationKey, type AssessedRecord } from './validation';

type Accepted = Extract<AssessedRecord, { ok: true }>;
type Rejected = Extract<AssessedRecord, { ok: false }>;

export type AuthedStation = { id: number; code: string; name: string; regionId: number; status: string };

/**
 * Resolves the station from the URL code and checks the bearer key against the stored SHA-256 hash.
 * Unknown stations, simulated stations and wrong keys all produce the same 401 (no station enumeration).
 */
export async function authenticateStation(db: DB, code: string, authorization: string | null): Promise<AuthedStation> {
  const key = parseBearer(authorization);
  if (!key) throw new HttpError(401, 'Missing station API key. Send "Authorization: Bearer <station key>".');
  const [s] = await db
    .select({
      id: weatherStations.id,
      code: weatherStations.code,
      name: weatherStations.name,
      regionId: weatherStations.regionId,
      status: weatherStations.status,
      stationType: weatherStations.stationType,
      apiKeyHash: weatherStations.apiKeyHash,
    })
    .from(weatherStations)
    .where(eq(weatherStations.code, code))
    .limit(1);
  if (!s || s.stationType !== 'iot' || !verifyStationKey(key, s.apiKeyHash)) {
    throw new HttpError(401, 'Invalid station code or API key.');
  }
  return { id: s.id, code: s.code, name: s.name, regionId: s.regionId, status: s.status };
}

export type IngestResult = {
  station: string;
  ingestionRunId: string;
  received: number;
  accepted: number;
  duplicates: number;
  suspect: { index: number; observedAt: string; flags: string[] }[];
  rejected: { index: number; reason: string; detail: string }[];
};

/** Validates, de-duplicates and stores a payload for an authenticated station. Throws ZodError on malformed input. */
export async function ingestObservations(db: DB, station: AuthedStation, body: unknown, now: Date = new Date()): Promise<IngestResult> {
  const records = parseObservationPayload(body);

  // Context for jump detection: stored observations around the batch window.
  const times = records.map((r) => Date.parse(r.observedAt)).filter(Number.isFinite);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const context =
    times.length > 0
      ? await db
          .select({
            observedAt: stationObservations.observedAt,
            tempC: stationObservations.tempC,
            humidityPct: stationObservations.humidityPct,
            pressureHpa: stationObservations.pressureHpa,
          })
          .from(stationObservations)
          .where(
            and(
              eq(stationObservations.stationId, station.id),
              gte(stationObservations.observedAt, new Date(minT - JUMP_WINDOW_MS)),
              lte(stationObservations.observedAt, new Date(maxT)),
            ),
          )
          .orderBy(asc(stationObservations.observedAt))
          .limit(5000)
      : [];

  const assessed = assessBatch(records, context, now);
  const ok = assessed.filter((a): a is Accepted => a.ok);
  const rejected = assessed.filter((a): a is Rejected => !a.ok);

  const [source] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, SOURCE_KEYS.iot)).limit(1);
  if (!source) throw new HttpError(503, 'IoT gateway data source is not configured.');

  const [run] = await db
    .insert(ingestionRuns)
    .values({ sourceId: source.id, job: 'iot', status: 'running', triggeredBy: `iot:${station.code}`, startedAt: now, recordsIn: records.length })
    .returning({ id: ingestionRuns.id });

  try {
    let written = 0;
    const insertedAt = new Set<number>();
    if (ok.length) {
      const inserted = await db
        .insert(stationObservations)
        .values(
          ok.map((r) => ({
            stationId: station.id,
            observedAt: r.observedAt,
            tempC: r.tempC,
            humidityPct: r.humidityPct,
            windKmh: r.windKmh,
            pressureHpa: r.pressureHpa,
            dataKind: 'observed' as const, // in-situ measurement, but quality stays unverified/suspect
            quality: r.quality,
            ingestionRunId: run.id,
          })),
        )
        .onConflictDoNothing({ target: [stationObservations.stationId, stationObservations.observedAt] })
        .returning({ observedAt: stationObservations.observedAt });
      written = inserted.length;
      for (const r of inserted) insertedAt.add(r.observedAt.getTime());
    }
    const inBatchDupes = rejected.filter((r) => r.reason === 'duplicate_in_batch').length;
    const duplicates = ok.length - written + inBatchDupes;
    const hardRejected = rejected.length - inBatchDupes;
    // Only records that were actually stored are reported as suspect (duplicates were not written).
    const suspect = ok.filter((r) => r.quality === 'suspect' && insertedAt.has(r.observedAt.getTime()));

    // Any usable contact marks the station online; a payload where every record was rejected marks it degraded.
    const nextStatus = ok.length > 0 ? 'online' : 'degraded';
    await db.update(weatherStations).set({ lastSeenAt: now, status: nextStatus }).where(eq(weatherStations.id, station.id));

    const runStatus = hardRejected === 0 ? 'succeeded' : ok.length > 0 ? 'partial' : 'failed';
    await db
      .update(ingestionRuns)
      .set({
        status: runStatus,
        finishedAt: new Date(),
        recordsWritten: written,
        error: hardRejected ? `${hardRejected} record(s) rejected` : null,
        meta: {
          station: station.code,
          duplicates,
          suspect: suspect.length,
          rejected: hardRejected,
          reasons: countBy(rejected.map((r) => r.reason)),
        },
      })
      .where(eq(ingestionRuns.id, run.id));

    await db.insert(auditLogs).values({
      actorId: null,
      actorLabel: `iot:${station.code}`,
      action: 'station.observations_ingested',
      entityType: 'weather_station',
      entityId: station.code,
      regionId: station.regionId,
      after: { ingestionRunId: run.id, received: records.length, written, duplicates, suspect: suspect.length, rejected: hardRejected },
    });

    return {
      station: station.code,
      ingestionRunId: run.id,
      received: records.length,
      accepted: written,
      duplicates,
      suspect: suspect.map((r) => ({ index: r.index, observedAt: r.observedAt.toISOString(), flags: r.flags })),
      rejected: rejected.filter((r) => r.reason !== 'duplicate_in_batch').map((r) => ({ index: r.index, reason: r.reason, detail: r.detail })),
    };
  } catch (err) {
    await db
      .update(ingestionRuns)
      .set({ status: 'failed', finishedAt: new Date(), error: err instanceof Error ? err.message.slice(0, 500) : 'unknown error' })
      .where(eq(ingestionRuns.id, run.id));
    throw err;
  }
}

function countBy(values: string[]) {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
