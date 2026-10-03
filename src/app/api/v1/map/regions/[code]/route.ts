import { api, HttpError, rateLimit } from '@/server/http';
import { getDb } from '@/server/db/client';
import { authorize } from '@/server/auth/dal';
import { currentScenario } from '@/server/scenario';
import { latestRun } from '@/server/forecasting/queries';
import { regionDetail, runSummary } from '@/server/command/map-data';

type Ctx = { params: Promise<{ code: string }> };

/**
 * GET /api/v1/map/regions/{code} — side-panel detail for a state, district or city: forecast series of the latest
 * run (cities resolve to their district's forecast) and the cities of a district.
 */
export const GET = api(async (_req: Request, ctx: Ctx) => {
  const user = await authorize('dashboard:view');
  rateLimit(`map:${user.id}`, 240, 60_000);
  const { code } = await ctx.params;
  if (!/^[A-Z0-9-]{2,80}$/.test(code)) throw new HttpError(400, 'Invalid region code');
  const db = getDb();
  const scenario = await currentScenario();
  const run = await latestRun(db, scenario);
  const detail = await regionDetail(db, run?.id ?? null, code);
  if (!detail) throw new HttpError(404, 'Region not found');
  return Response.json({ data: detail, meta: { scenario, run: run ? runSummary(run) : null } });
});
