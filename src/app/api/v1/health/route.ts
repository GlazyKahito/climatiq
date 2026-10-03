import { desc, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { forecastRuns, ingestionRuns } from '@/server/db/schema';

/** GET /api/v1/health — liveness + data freshness (no secrets, no personal data). */
export async function GET() {
  const started = Date.now();
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const [lastIngestion] = await db.select({ at: ingestionRuns.finishedAt, status: ingestionRuns.status, job: ingestionRuns.job }).from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt)).limit(1);
    const [lastRun] = await db.select({ at: forecastRuns.createdAt, scenario: forecastRuns.scenario, status: forecastRuns.status }).from(forecastRuns).orderBy(desc(forecastRuns.createdAt)).limit(1);
    return Response.json({ status: 'ok', db: 'up', latencyMs: Date.now() - started, lastIngestion: lastIngestion ?? null, lastForecastRun: lastRun ?? null });
  } catch {
    return Response.json({ status: 'degraded', db: 'down' }, { status: 503 });
  }
}
