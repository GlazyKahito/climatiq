/** Maintenance: runs a fresh live forecast (Open-Meteo NWP) and removes superseded live runs from the same day. */
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, ne } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../src/server/db/schema';
import type { DB } from '../src/server/db/types';
import { runForecast } from '../src/server/forecasting/run';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema }) as unknown as DB;
  const r = await runForecast(db, { scenario: 'live', triggeredBy: 'maintenance:rerun-live', skipAlerts: process.argv.includes('--skip-alerts') });
  console.log('live run:', r);
  if (r.status !== 'failed' && process.argv.includes('--prune-same-day')) {
    const [run] = await db.select().from(schema.forecastRuns).where(eq(schema.forecastRuns.id, r.runId));
    await db.delete(schema.forecastRuns).where(and(eq(schema.forecastRuns.scenario, 'live'), eq(schema.forecastRuns.issuedFor, run.issuedFor), ne(schema.forecastRuns.id, r.runId)));
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
