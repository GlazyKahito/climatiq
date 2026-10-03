import { z } from 'zod';
import { api, rateLimit } from '@/server/http';
import { authorize } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { currentScenario } from '@/server/scenario';
import { forecastTable, latestRunDetail, runDays } from '@/server/analytics/forecast-views';
import { isoDate, scenarioParam } from '@/server/analytics/params';

const query = z.object({
  scenario: scenarioParam.optional(),
  day: isoDate.optional(),
  level: z.enum(['state', 'district']).optional(),
});

/**
 * GET /api/v1/forecasts?scenario=replay&day=2024-05-28&level=district
 * Forecasts of the latest successful run of a scenario for one target day (default: day 1). Signed-in (`dashboard:view`).
 */
export const GET = api(async (req: Request) => {
  const user = await authorize('dashboard:view');
  rateLimit(`forecasts:${user.id}`, 120, 60_000);
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const scenario = q.scenario ?? (await currentScenario());
  const db = getDb();
  const run = await latestRunDetail(db, scenario);
  if (!run) return Response.json({ data: [], meta: { scenario, run: null, days: [], message: `No ${scenario} forecast run is available.` } });
  const days = await runDays(db, run.id);
  const day = q.day ?? days[0];
  if (q.day && !days.includes(q.day)) {
    return Response.json({ data: [], meta: { scenario, run: runMeta(run), days, day: q.day, message: 'The run has no forecasts for this day.' } });
  }
  const rows = day ? await forecastTable(db, run.id, day, { level: q.level }) : [];
  return Response.json({
    data: rows.map((r) => ({
      region: { code: r.code, name: r.name, level: r.level, stateCode: r.stateCode, stateName: r.stateName, climateZone: r.climateZone },
      targetDate: r.targetDate,
      horizonDay: r.horizonDay,
      resolution: r.resolution,
      predictedTmaxC: r.predictedTmaxC,
      interval: { lowerC: r.lowerC, upperC: r.upperC, nominal: '80% heuristic band, uncalibrated' },
      nwpTmaxC: r.nwpTmaxC,
      normalTmaxC: r.normalTmaxC,
      departureC: r.departureC,
      severity: r.severity,
      peakSeverity: r.peakSeverity,
      imdCriteriaCategory: r.imdCategory,
      confidence: { label: r.confidence, heuristicScore: r.confidenceScore, isProbability: false },
      durationDays: r.durationDays,
    })),
    meta: {
      scenario,
      run: runMeta(run),
      days,
      day,
      provenance: { kind: 'model_forecast', source: `CLIMATIQ ${run.modelKey}`, official: false },
      disclaimer: 'CLIMATIQ decision-support output derived from IMD heatwave criteria; not an official IMD forecast or warning.',
    },
  });
});

function runMeta(run: NonNullable<Awaited<ReturnType<typeof latestRunDetail>>>) {
  return {
    id: run.id,
    scenario: run.scenario,
    issuedFor: run.issuedFor,
    horizonDays: run.horizonDays,
    isHindcast: run.isHindcast,
    status: run.status,
    model: run.modelKey,
    generatedAt: run.createdAt,
    inputs: run.inputs,
  };
}
