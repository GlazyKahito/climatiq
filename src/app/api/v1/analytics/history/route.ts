import { z } from 'zod';
import { api, HttpError, rateLimit } from '@/server/http';
import { authorize } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { getRegionByCode } from '@/server/geo/regions';
import { climateSeries } from '@/server/analytics/history';
import { daysBetween, isoDate, regionCode } from '@/server/analytics/params';

const query = z
  .object({ region: regionCode, from: isoDate, to: isoDate })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] })
  .refine((q) => daysBetween(q.from, q.to) <= 3700, { message: 'Range is limited to 3700 days', path: ['to'] });

/** GET /api/v1/analytics/history?region=IN-RJ&from=2024-04-01&to=2024-06-30 — daily climate history (JSON). `analytics:view`. */
export const GET = api(async (req: Request) => {
  const user = await authorize('analytics:view');
  rateLimit(`analytics:${user.id}`, 60, 60_000);
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = getDb();
  const region = await getRegionByCode(db, q.region);
  if (!region) throw new HttpError(404, `Unknown region ${q.region}`);
  const rows = await climateSeries(db, [region.id], q.from, q.to);
  return Response.json({
    data: rows.map((r) => ({ day: r.day, tmaxC: r.tmaxC, tminC: r.tminC, apparentTmaxC: r.apparentTmaxC, rhMeanPct: r.rhMeanPct, windMaxKmh: r.windMaxKmh, radiationMj: r.radiationMj, dataKind: r.dataKind, source: r.sourceName, updatedAt: r.updatedAt })),
    meta: {
      region: { code: region.code, name: region.name, level: region.level },
      units: { tmaxC: '°C', tminC: '°C', apparentTmaxC: '°C', rhMeanPct: '%', windMaxKmh: 'km/h', radiationMj: 'MJ/m²' },
      note: 'NWP guidance is excluded; values are observed, reanalysis (ERA5) or simulated as stated per row.',
    },
  });
});
