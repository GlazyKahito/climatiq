import { z } from 'zod';
import { api, HttpError, rateLimit } from '@/server/http';
import { authorize } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { audit } from '@/server/audit/log';
import { getRegionByCode } from '@/server/geo/regions';
import { csvResponse } from '@/server/analytics/csv';
import { historyCsv } from '@/server/analytics/exports';
import { daysBetween, isoDate, regionCode } from '@/server/analytics/params';

const MAX_DAYS = 3700; // ~10 years

const query = z
  .object({ region: regionCode, from: isoDate, to: isoDate })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] })
  .refine((q) => daysBetween(q.from, q.to) <= MAX_DAYS, { message: `Range is limited to ${MAX_DAYS} days`, path: ['to'] });

/**
 * GET /api/v1/export/history.csv?region=IN-RJ&from=2024-05-01&to=2024-06-30 — daily climate history for one region
 * (observed / reanalysis / simulated; NWP guidance is excluded). Requires `analytics:export` on that region.
 */
export const GET = api(async (req: Request) => {
  const caller = await authorize('analytics:export');
  rateLimit(`export:${caller.id}`, 20, 60_000);
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = getDb();
  const region = await getRegionByCode(db, q.region);
  if (!region) throw new HttpError(404, `Unknown region ${q.region}`);
  const user = await authorize('analytics:export', region.id); // region-scoped check
  const file = await historyCsv(db, region, q.from, q.to);
  await audit(db, { actor: { id: user.id, name: user.name }, action: 'export.history_csv', entityType: 'region', entityId: region.code, regionId: region.id, after: { from: q.from, to: q.to, rows: file.rows } });
  return csvResponse(file.body, file.filename);
});
