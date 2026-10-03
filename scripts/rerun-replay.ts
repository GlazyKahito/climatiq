/** Maintenance: (re)imports archived as-issued NWP and regenerates the replay hindcast run. */
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../src/server/db/schema';
import type { DB } from '../src/server/db/types';
import { importReplayNwp } from '../src/server/db/seed/history';
import { runForecast } from '../src/server/forecasting/run';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema }) as unknown as DB;
  const ops = await db.select().from(schema.seedState).where(eq(schema.seedState.step, 'operations'));
  const [{ a }] = await db.select({ a: sql<number>`count(*)::int` }).from(schema.alerts);
  const [{ b }] = await db.select({ b: sql<number>`count(*)::int` }).from(schema.advisories);
  const refs = { rows: [{ a, b }] };
  console.log('operations seeded:', ops.length > 0, 'alerts/advisories:', refs.rows[0]);
  console.log('replay NWP rows imported:', await importReplayNwp(db));
  await db.delete(schema.forecastRuns).where(eq(schema.forecastRuns.scenario, 'replay'));
  const r = await runForecast(db, { scenario: 'replay', triggeredBy: 'maintenance:rerun-replay', skipAlerts: true });
  console.log('replay run:', r);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
