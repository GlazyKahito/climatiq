import { z } from 'zod';
import { api, clientKey, rateLimit } from '@/server/http';
import { getDb } from '@/server/db/client';
import { childrenOf, getRegionByCode, regionsByLevel, searchRegions } from '@/server/geo/regions';

const query = z.object({
  q: z.string().max(60).optional(),
  level: z.enum(['country', 'state', 'district', 'city']).optional(),
  parent: z.string().max(80).optional(),
  pilot: z.enum(['true', 'false']).optional(),
});

/** GET /api/v1/regions — public geographic reference data (names, hierarchy, centroids). */
export const GET = api(async (req: Request) => {
  rateLimit(`regions:${clientKey(req)}`, 120, 60_000);
  const params = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = getDb();
  if (params.q) return Response.json({ data: await searchRegions(db, params.q) });
  if (params.parent) {
    const parent = await getRegionByCode(db, params.parent);
    if (!parent) return Response.json({ data: [] });
    return Response.json({ data: await childrenOf(db, parent.id) });
  }
  return Response.json({ data: await regionsByLevel(db, params.level ?? 'state', { pilotOnly: params.pilot === 'true' }) });
});
