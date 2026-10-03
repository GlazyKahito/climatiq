import { api, HttpError } from '@/server/http';
import { getDb } from '@/server/db/client';
import { env } from '@/server/config/env';
import { refreshAll } from '@/server/ingestion/runner';
import { audit } from '@/server/audit/log';

export const maxDuration = 300;

/**
 * GET /api/v1/cron/refresh — daily scheduled ingestion (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
 * Refreshes recent ERA5 history, the live NWP heat grid, runs a live forecast (which raises alerts) and retention.
 */
export const GET = api(async (req: Request) => {
  const secret = env().CRON_SECRET;
  if (!secret) throw new HttpError(503, 'CRON_SECRET is not configured');
  if (req.headers.get('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'Invalid cron credentials');
  const db = getDb();
  const result = await refreshAll(db, 'cron');
  await audit(db, { actor: 'system', action: 'ingestion.cron', entityType: 'ingestion', after: { jobs: result.jobs.map((j) => ({ job: j.job, status: j.status })), forecast: result.forecast.status } });
  return Response.json({ data: result });
});
