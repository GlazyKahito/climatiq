import { z } from 'zod';
import { api, rateLimit } from '@/server/http';
import { authorize } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { accuracyReport, listRuns } from '@/server/analytics/accuracy';
import { runParam } from '@/server/analytics/params';

const query = z.object({ run: runParam.optional(), level: z.enum(['state', 'district']).optional() });

/**
 * GET /api/v1/analytics/accuracy?run=<uuid>&level=state — verification metrics (MAE, RMSE, bias by horizon and region,
 * band coverage, severity confusion matrix). Defaults to the most recent run that has verifications. `analytics:view`.
 */
export const GET = api(async (req: Request) => {
  const user = await authorize('analytics:view');
  rateLimit(`analytics:${user.id}`, 60, 60_000);
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = getDb();
  const runs = await listRuns(db);
  const runId = q.run ?? runs.find((r) => r.verifiedCount > 0)?.id;
  if (!runId) return Response.json({ data: null, meta: { message: 'No verified forecast runs yet.', runs } });
  const report = await accuracyReport(db, { runIds: [runId], level: q.level });
  return Response.json({
    data: report,
    meta: {
      runId,
      level: q.level ?? 'all',
      units: { mae: '°C', rmse: '°C', bias: '°C (predicted − observed)' },
      truth: report.observedKinds,
      caveats: [
        'Truth is ERA5 reanalysis at region centroids, not station observations.',
        'A single historical event does not establish general forecast skill.',
        'Band coverage measures how often truth fell inside the nominal 80 % heuristic band.',
      ],
    },
  });
});
