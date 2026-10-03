import { z } from 'zod';
import { api, rateLimit } from '@/server/http';
import { getDb } from '@/server/db/client';
import { authorize } from '@/server/auth/dal';
import { gridPayload } from '@/server/command/map-data';

const query = z.object({ day: z.iso.date() });

/**
 * GET /api/v1/map/grid?day=YYYY-MM-DD — heat-layer grid (Tmax per grid cell) for one day with its provenance
 * (`kind`: reanalysis / nwp_forecast / simulated). Empty `points` when no grid exists for the day.
 */
export const GET = api(async (req: Request) => {
  const user = await authorize('dashboard:view');
  rateLimit(`map:${user.id}`, 240, 60_000);
  const { day } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json({ data: await gridPayload(getDb(), day) }, { headers: { 'Cache-Control': 'private, max-age=300' } });
});
