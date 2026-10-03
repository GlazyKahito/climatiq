import { z } from 'zod';
import { api, HttpError, rateLimit } from '@/server/http';
import { authorize } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { currentScenario } from '@/server/scenario';
import { ancestorsOf, getRegionByCode } from '@/server/geo/regions';
import { forecastSeries } from '@/server/forecasting/queries';
import { latestRunDetail } from '@/server/analytics/forecast-views';
import { regionCode, scenarioParam } from '@/server/analytics/params';

const query = z.object({ scenario: scenarioParam.optional() });

/**
 * GET /api/v1/forecasts/{code}?scenario=replay — full forecast horizon for one region. Cities resolve to their parent
 * district's forecast and say so in `resolutionNote`. Signed-in (`dashboard:view`).
 */
export const GET = api(async (req: Request, ctx: RouteContext<'/api/v1/forecasts/[code]'>) => {
  const user = await authorize('dashboard:view');
  rateLimit(`forecasts:${user.id}`, 120, 60_000);
  const { code: raw } = await ctx.params;
  const code = regionCode.parse(decodeURIComponent(raw));
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = getDb();
  const region = await getRegionByCode(db, code);
  if (!region) throw new HttpError(404, `Unknown region ${code}`);
  const scenario = q.scenario ?? (await currentScenario());
  const run = await latestRunDetail(db, scenario);
  const ancestors = await ancestorsOf(db, region.path);
  const target = region.level === 'city' ? (ancestors.find((a) => a.level === 'district') ?? region) : region;
  const series = run && region.level !== 'country' ? await forecastSeries(db, run.id, target.id) : [];
  return Response.json({
    data: series.map((s) => ({
      targetDate: s.targetDate,
      horizonDay: s.horizonDay,
      resolution: s.resolution,
      predictedTmaxC: s.predictedTmaxC,
      interval: { lowerC: s.lowerC, upperC: s.upperC, nominal: '80% heuristic band, uncalibrated' },
      predictedTminC: s.predictedTminC,
      nwpTmaxC: s.nwpTmaxC,
      normalTmaxC: s.normalTmaxC,
      departureC: s.departureC,
      severity: s.severity,
      imdCriteriaCategory: s.imdCategory,
      confidence: { label: s.confidence, heuristicScore: s.confidenceScore, isProbability: false },
      durationDays: s.durationDays,
      factors: s.factors,
      inputKinds: s.inputKinds,
    })),
    meta: {
      region: { code: region.code, name: region.name, level: region.level, path: region.path },
      forecastRegion: { code: target.code, name: target.name, level: target.level },
      resolutionNote:
        region.level === 'city'
          ? `No city-level forecast: values are the ${target.name} district forecast at its centroid.`
          : region.level === 'country'
            ? 'No national forecast is produced; query states (e.g. /api/v1/forecasts?level=state).'
            : null,
      scenario,
      run: run
        ? { id: run.id, issuedFor: run.issuedFor, horizonDays: run.horizonDays, isHindcast: run.isHindcast, status: run.status, model: run.modelKey, generatedAt: run.createdAt, inputs: run.inputs, params: run.params }
        : null,
      provenance: { kind: 'model_forecast', source: run ? `CLIMATIQ ${run.modelKey}` : null, official: false },
      disclaimer: 'IMD-criteria-based indicator, not an IMD declaration. Confidence is heuristic, not a probability.',
    },
  });
});
