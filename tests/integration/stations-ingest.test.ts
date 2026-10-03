import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import { auditLogs, ingestionRuns, regions, stationObservations, users, weatherStations } from '@/server/db/schema';
import { seedReference } from '@/server/db/seed/reference';
import { seedStations, simStationCode, STATION_PLAN } from '@/server/db/seed/stations';
import { registerIotStation, rotateStationKey } from '@/server/stations/register';
import { authenticateStation, ingestObservations } from '@/server/stations/ingest';
import { getStation, listStations, statusSummary } from '@/server/stations/queries';
import { hashStationKey } from '@/server/stations/validation';
import { setDb } from '@/server/db/client';

let db: DB;
let close: () => Promise<void>;
let actor: { id: string; name: string };
let key: string;
let code: string;
const NOW = new Date();

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedReference(db);
  const [india] = await db.insert(regions).values({ code: 'IN', name: 'India', level: 'country', path: 'IN', lat: 22, lon: 79, geoSource: 'test' }).returning();
  const [rj] = await db
    .insert(regions)
    .values({ code: 'IN-RJ', name: 'Rajasthan', level: 'state', parentId: india.id, path: 'IN/IN-RJ', lat: 26.8, lon: 73.8, geoSource: 'test', isPilot: true })
    .returning();
  await db.insert(regions).values([
    { code: 'IN-RJ-JAIPUR', name: 'Jaipur', level: 'district', parentId: rj.id, path: 'IN/IN-RJ/IN-RJ-JAIPUR', lat: 26.97, lon: 75.73, geoSource: 'test', isPilot: true },
    { code: 'IN-RJ-JODHPUR', name: 'Jodhpur', level: 'district', parentId: rj.id, path: 'IN/IN-RJ/IN-RJ-JODHPUR', lat: 26.74, lon: 72.7, geoSource: 'test', isPilot: true },
    { code: 'IN-RJ-BARMER', name: 'Barmer', level: 'district', parentId: rj.id, path: 'IN/IN-RJ/IN-RJ-BARMER', lat: 25.74, lon: 71.47, geoSource: 'test', isPilot: true },
  ]);
  const [u] = await db.insert(users).values({ email: 'officer@climatiq.demo', name: 'Test Officer', passwordHash: 'x', isDemo: true }).returning();
  actor = { id: u.id, name: u.name };
});
afterAll(async () => {
  setDb(undefined);
  await close();
});

describe('IoT station registration', () => {
  it('creates an iot station and stores only the key hash', async () => {
    const res = await registerIotStation(
      db,
      { name: 'Jaipur rooftop sensor', regionCode: 'IN-RJ-JAIPUR', lat: 26.91, lon: 75.79, sensors: ['temperature', 'humidity'] },
      actor,
    );
    key = res.apiKey;
    code = res.code;
    expect(code).toBe('IOT-RJ-001');
    const [row] = await db.select().from(weatherStations).where(eq(weatherStations.code, code));
    expect(row).toMatchObject({ stationType: 'iot', isSimulated: false, status: 'planned' });
    expect(row.apiKeyHash).toBe(hashStationKey(key));
    expect(row.apiKeyHash).not.toContain(key);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, 'station.register'));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].after)).not.toContain(key);
    // second station in the same state gets the next code
    const second = await registerIotStation(db, { name: 'Jodhpur sensor', regionCode: 'IN-RJ-JODHPUR', lat: 26.3, lon: 73.0, sensors: ['temperature'] }, actor);
    expect(second.code).toBe('IOT-RJ-002');
  });

  it('authenticates with the bearer key and rejects wrong keys uniformly', async () => {
    await expect(authenticateStation(db, code, `Bearer ${key}`)).resolves.toMatchObject({ code });
    await expect(authenticateStation(db, code, 'Bearer cqst_wrong-key-000000')).rejects.toMatchObject({ status: 401 });
    await expect(authenticateStation(db, 'IOT-XX-999', `Bearer ${key}`)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateStation(db, code, null)).rejects.toMatchObject({ status: 401 });
  });
});

describe('IoT ingestion', () => {
  const t = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

  it('stores observations as unverified, flags suspect jumps, rejects bad records, records a run', async () => {
    const station = await authenticateStation(db, code, `Bearer ${key}`);
    const res = await ingestObservations(
      db,
      station,
      {
        observations: [
          { observedAt: t(3), tempC: 38.1, humidityPct: 22 },
          { observedAt: t(2), tempC: 39.0, humidityPct: 20, windKmh: 12, pressureHpa: 1001 },
          { observedAt: t(1), tempC: 50.5, humidityPct: 19 }, // +11.5 °C in an hour → suspect
          { observedAt: new Date(NOW.getTime() + 60 * 60_000).toISOString(), tempC: 40 }, // future → rejected
          { observedAt: t(24 * 40), tempC: 30 }, // too old → rejected
        ],
      },
      NOW,
    );
    expect(res).toMatchObject({ received: 5, accepted: 3, duplicates: 0 });
    expect(res.suspect).toHaveLength(1);
    expect(res.suspect[0].flags).toContain('sudden_jump_tempC');
    expect(res.rejected.map((r) => r.reason).sort()).toEqual(['future_timestamp', 'too_old']);

    const obs = await db.select().from(stationObservations).where(eq(stationObservations.stationId, station.id));
    expect(obs).toHaveLength(3);
    expect(obs.every((o) => o.dataKind === 'observed' && o.quality !== 'verified')).toBe(true);
    expect(obs.filter((o) => o.quality === 'suspect')).toHaveLength(1);

    const [run] = await db.select().from(ingestionRuns).where(eq(ingestionRuns.id, res.ingestionRunId));
    expect(run).toMatchObject({ job: 'iot', triggeredBy: `iot:${code}`, status: 'partial', recordsIn: 5, recordsWritten: 3 });

    const [s] = await db.select().from(weatherStations).where(eq(weatherStations.code, code));
    expect(s.status).toBe('online');
    expect(s.lastSeenAt?.getTime()).toBe(NOW.getTime());

    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'station.observations_ingested'), eq(auditLogs.entityId, code)));
    expect(audits[0].actorLabel).toBe(`iot:${code}`);
  });

  it('de-duplicates on (station, observedAt) — retries are idempotent', async () => {
    const station = await authenticateStation(db, code, `Bearer ${key}`);
    const again = await ingestObservations(db, station, { observations: [{ observedAt: t(3), tempC: 38.1 }, { observedAt: t(0.5), tempC: 49.9 }] }, NOW);
    expect(again).toMatchObject({ received: 2, accepted: 1, duplicates: 1 });
    const single = await ingestObservations(db, station, { observedAt: t(0.5), tempC: 49.9 }, NOW);
    expect(single).toMatchObject({ accepted: 0, duplicates: 1, rejected: [] });
    const obs = await db.select().from(stationObservations).where(eq(stationObservations.stationId, station.id));
    expect(obs).toHaveLength(4);
  });

  it('a key rotation invalidates the old key', async () => {
    const { apiKey } = await rotateStationKey(db, code, actor);
    await expect(authenticateStation(db, code, `Bearer ${key}`)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateStation(db, code, `Bearer ${apiKey}`)).resolves.toMatchObject({ code });
    key = apiKey;
  });
});

describe('POST /api/v1/stations/{code}/observations route', () => {
  it('returns the uniform envelope for auth, validation and success', async () => {
    setDb(db);
    const { POST } = await import('@/app/api/v1/stations/[code]/observations/route');
    const ctx = { params: Promise.resolve({ code }) };
    const url = `http://localhost/api/v1/stations/${code}/observations`;

    const unauth = await POST(new Request(url, { method: 'POST', body: JSON.stringify({ observedAt: new Date().toISOString(), tempC: 30 }) }), ctx);
    expect(unauth.status).toBe(401);
    expect((await unauth.json()).error.code).toBe('unauthenticated');

    const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
    const bad = await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify({ observedAt: 'yesterday', tempC: 30 }) }), ctx);
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.error.code).toBe('invalid_request');
    expect(badBody.error.details[0].path).toBe('observedAt');

    const future = await POST(
      new Request(url, { method: 'POST', headers, body: JSON.stringify({ observedAt: new Date(Date.now() + 3_600_000).toISOString(), tempC: 30 }) }),
      ctx,
    );
    expect(future.status).toBe(422);
    expect((await future.json()).error.details.rejected[0].reason).toBe('future_timestamp');

    const ok = await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify({ observedAt: new Date().toISOString(), tempC: 31.4, humidityPct: 40 }) }), ctx);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data).toMatchObject({ station: code, accepted: 1, duplicates: 0 });
  });
});

describe('simulated station seed', () => {
  it('creates labelled simulated stations with hourly simulated observations (idempotent)', async () => {
    const res = await seedStations(db, { now: NOW });
    const planned = STATION_PLAN.filter((p) => ['IN-RJ-JAIPUR', 'IN-RJ-JODHPUR', 'IN-RJ-BARMER'].includes(p.district));
    expect(res.stations).toBe(planned.length);
    expect(res.skipped.length).toBeGreaterThan(0); // districts not present in this test DB are skipped
    const sims = await db.select().from(weatherStations).where(eq(weatherStations.stationType, 'aws_simulated'));
    expect(sims.every((s) => s.isSimulated && s.isDemo && s.apiKeyHash === null && s.name.includes('(simulated)'))).toBe(true);
    const jaipur1 = sims.find((s) => s.code === simStationCode('IN-RJ-JAIPUR', 1))!;
    const obs = await db.select().from(stationObservations).where(eq(stationObservations.stationId, jaipur1.id));
    expect(obs).toHaveLength(168);
    expect(obs.every((o) => o.dataKind === 'simulated')).toBe(true);

    const again = await seedStations(db, { now: NOW });
    expect(again.stations).toBe(0);
    expect(again.observations).toBe(0);

    const list = await listStations(db, {}, NOW);
    const summary = statusSummary(list);
    expect(summary.simulated).toBe(planned.length);
    expect(summary.real).toBe(2);
    expect(list.find((s) => s.code === simStationCode('IN-RJ-BARMER', 1))?.status).toBe('offline');
    expect(JSON.stringify(list)).not.toContain('apiKeyHash');

    const detail = await getStation(db, jaipur1.code, NOW);
    expect(detail?.stats.last7d).toBe(168);
    expect(detail?.stateCode).toBe('IN-RJ');
  });
});
