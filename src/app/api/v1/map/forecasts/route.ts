import { z } from 'zod';
import { api, rateLimit } from '@/server/http';
import { getDb } from '@/server/db/client';
import { authorize } from '@/server/auth/dal';
import { currentScenario } from '@/server/scenario';
import { latestRun } from '@/server/forecasting/queries';
import { runForecasts, runSummary } from '@/server/command/map-data';

const query = z.object({
  level: z.enum(['state', 'district']).default('district'),
  parent: z
    .string()
    .regex(/^IN-[A-Z]{2}$/, 'parent must be a state code such as IN-RJ')
    .optional(),
});

/**
 * GET /api/v1/map/forecasts?level=district&parent=IN-RJ — CLIMATIQ forecasts (all target days of the latest run of
 * the current scenario) shaped for the command-center map. Signed-in, `dashboard:view`.
 */
export const GET = api(async (req: Request) => {
  const user = await authorize('dashboard:view');
  rateLimit(`map:${user.id}`, 240, 60_000);
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = getDb();
  const scenario = await currentScenario();
  const run = await latestRun(db, scenario);
  if (!run) return Response.json({ data: [], meta: { scenario, run: null } });
  const data = await runForecasts(db, run.id, q.level, q.parent);
  return Response.json({
    data,
    meta: { scenario, run: runSummary(run), provenance: { kind: 'model_forecast', source: `CLIMATIQ ${run.modelKey}`, official: false } },
  });
});
