import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import { alerts, regions, roles, seedState, severityThresholds } from '@/server/db/schema';
import { runSeed, SEED_STEPS } from '@/server/db/seed';

let db: DB;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

describe('migrations & constraints', () => {
  it('creates all tables', async () => {
    const res = (await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`)) as unknown as { rows: { n: number }[] };
    expect(Number(res.rows[0].n)).toBeGreaterThanOrEqual(31);
  });

  it('enforces the country/parent rule on regions', async () => {
    await db.insert(regions).values({ code: 'IN', name: 'India', level: 'country', path: 'IN', lat: 22, lon: 79, geoSource: 'test' });
    await expect(
      db.insert(regions).values({ code: 'X', name: 'Orphan state', level: 'state', path: 'X', lat: 1, lon: 1, geoSource: 'test' }),
    ).rejects.toThrow();
  });

  it('rejects out-of-range coordinates', async () => {
    await expect(
      db.insert(regions).values({ code: 'BAD', name: 'Bad', level: 'country', path: 'BAD', lat: 120, lon: 1, geoSource: 'test' }),
    ).rejects.toThrow();
  });

  it('allows only one open alert per dedup key', async () => {
    const [india] = await db.select().from(regions).where(eq(regions.code, 'IN'));
    const base = { regionId: india.id, severity: 'high' as const, title: 't', message: 'm', targetDate: '2024-05-27', dedupKey: 'k1', confidenceScore: 0.5 };
    await db.insert(alerts).values(base);
    await expect(db.insert(alerts).values(base)).rejects.toThrow();
    await db.update(alerts).set({ status: 'resolved' }).where(eq(alerts.dedupKey, 'k1'));
    await expect(db.insert(alerts).values(base)).resolves.toBeDefined();
  });
});

describe('seed', () => {
  it('reference step is idempotent', async () => {
    const steps = SEED_STEPS.filter((s) => s.key === 'reference');
    await runSeed(db, { steps });
    await runSeed(db, { steps });
    const r = await db.select().from(roles);
    expect(r).toHaveLength(8);
    const t = await db.select().from(severityThresholds);
    expect(t).toHaveLength(12);
    const s = await db.select().from(seedState);
    expect(s.map((x) => x.step)).toContain('reference');
  });
});
