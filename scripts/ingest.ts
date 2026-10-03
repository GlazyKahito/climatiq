/**
 * Manual ingestion CLI:  node --env-file=.env.local --import tsx scripts/ingest.ts <history|grid|forecast|all>
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/server/db/schema';
import type { DB } from '../src/server/db/types';
import { refreshAll, refreshLiveGrid, refreshRecentHistory } from '../src/server/ingestion/runner';
import { runForecast } from '../src/server/forecasting/run';

async function main() {
  const job = process.argv[2] ?? 'all';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema }) as unknown as DB;
  const out =
    job === 'history' ? await refreshRecentHistory(db, 'cli')
    : job === 'grid' ? await refreshLiveGrid(db, 'cli')
    : job === 'forecast' ? await runForecast(db, { scenario: 'live', triggeredBy: 'cli' })
    : await refreshAll(db, 'cli');
  console.log(JSON.stringify(out, null, 2));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
