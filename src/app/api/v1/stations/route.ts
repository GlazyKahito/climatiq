import { z } from 'zod';
import { api, rateLimit } from '@/server/http';
import { getDb } from '@/server/db/client';
import { authorize } from '@/server/auth/dal';
import { listStations, statusSummary } from '@/server/stations/queries';

const query = z.object({
  status: z.enum(['online', 'degraded', 'offline', 'planned']).optional(),
  type: z.enum(['aws_simulated', 'iot', 'external']).optional(),
  state: z
    .string()
    .regex(/^IN-[A-Z]{2}$/, 'state must be an ISO 3166-2 code such as IN-RJ')
    .optional(),
});

/** GET /api/v1/stations — station registry with effective status and latest observation (signed-in, `station:view`). */
export const GET = api(async (req: Request) => {
  const user = await authorize('station:view');
  rateLimit(`stations-read:${user.id}`, 120, 60_000);
  const filters = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const stations = await listStations(getDb(), filters);
  return Response.json({
    data: stations,
    meta: {
      ...statusSummary(stations),
      note: 'No physical stations are deployed in this prototype. Stations with isSimulated=true are demo stations whose observations are synthetic.',
    },
  });
});
