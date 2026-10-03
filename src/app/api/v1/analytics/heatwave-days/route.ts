import { z } from 'zod';
import { api, rateLimit } from '@/server/http';
import { authorize } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { currentScenario } from '@/server/scenario';
import { NORMAL_BASIS } from '@/server/forecasting/run';
import { regionsByCodes } from '@/server/analytics/regions';
import { heatwaveFrequency } from '@/server/analytics/heatwave';
import { isoDate, regionList, scenarioParam } from '@/server/analytics/params';

const query = z.object({ regions: regionList(40), from: isoDate.optional(), to: isoDate.optional(), scenario: scenarioParam.optional() });

/**
 * GET /api/v1/analytics/heatwave-days?regions=IN-RJ,IN-UP&scenario=replay — days per year meeting CLIMATIQ High /
 * Extreme (IMD-criteria-derived) against the scenario's reference normal. Indicator only. `analytics:view`.
 */
export const GET = api(async (req: Request) => {
  const user = await authorize('analytics:view');
  rateLimit(`analytics:${user.id}`, 60, 60_000);
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = getDb();
  const scenario = q.scenario ?? (await currentScenario());
  const regs = await regionsByCodes(db, q.regions);
  const data = await heatwaveFrequency(db, regs.map((r) => r.id), { from: q.from, to: q.to, basisKey: NORMAL_BASIS[scenario].key });
  return Response.json({
    data,
    meta: {
      basis: NORMAL_BASIS[scenario],
      unknownRegions: q.regions.filter((c) => !regs.some((r) => r.code === c)),
      method:
        'Each day with ERA5 Tmax is classified with the CLIMATIQ thresholds (IMD heatwave criteria: zone base 40/37/30 °C with departures ≥ 4.5 / 6.5 °C, or ≥ 45 / 47 °C on plains) against the reference normal for its day of year. heatwaveDays = High + Extreme.',
      caveat: 'Indicator, not an IMD declaration (no station data, no 2-station / 2-consecutive-day rule, few-year reference normal).',
    },
  });
});
