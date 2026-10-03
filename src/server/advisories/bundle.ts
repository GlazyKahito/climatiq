/**
 * Builds the validated forecast bundle — the single source of facts an advisory provider may use.
 * Everything here comes from stored CLIMATIQ forecasts and the data-source registry; nothing is invented.
 */
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { dataSources, forecastRuns, forecasts, modelVersions, officialWarnings, regions } from '../db/schema';
import { DomainError } from '../alerts/errors';
import { SOURCE_KEYS } from '../db/seed/reference';
import { SEVERITY_META, type Severity } from '@/lib/domain';
import { ForecastBundleSchema, type AudienceKey, type BundleDay, type BundleRegion, type BundleSource, type ForecastBundle } from './schema';

/** Advisories look at most this many days ahead — later days carry low heuristic confidence. */
export const ADVISORY_HORIZON_DAYS = 5;
export const MAX_ADVISORY_REGIONS = 12;

export const SCENARIO_LABELS = {
  replay: 'Historical replay · late-May 2024 North-India heatwave (ERA5 reanalysis + CLIMATIQ hindcast)',
  live: 'Live · CLIMATIQ forecast from current data',
} as const;

const sevRank = (s: Severity) => SEVERITY_META[s].rank;

function pickPeak(days: BundleDay[]): BundleDay {
  return days.reduce((best, d) =>
    sevRank(d.severity) > sevRank(best.severity) ||
    (sevRank(d.severity) === sevRank(best.severity) && d.predictedTmaxC > best.predictedTmaxC)
      ? d
      : best,
  );
}

export type BundleRequest = { runId: string; regionCodes: string[]; audience: AudienceKey };

export async function buildForecastBundle(db: DB, req: BundleRequest): Promise<ForecastBundle> {
  const codes = [...new Set(req.regionCodes.map((c) => c.trim()).filter(Boolean))];
  if (!codes.length) throw new DomainError(400, 'Select at least one region');
  if (codes.length > MAX_ADVISORY_REGIONS) throw new DomainError(400, `Select at most ${MAX_ADVISORY_REGIONS} regions per advisory`);

  const [run] = await db
    .select({
      id: forecastRuns.id,
      scenario: forecastRuns.scenario,
      issuedFor: forecastRuns.issuedFor,
      horizonDays: forecastRuns.horizonDays,
      isHindcast: forecastRuns.isHindcast,
      status: forecastRuns.status,
      inputs: forecastRuns.inputs,
      createdAt: forecastRuns.createdAt,
      modelKey: modelVersions.key,
      modelName: modelVersions.name,
    })
    .from(forecastRuns)
    .innerJoin(modelVersions, eq(modelVersions.id, forecastRuns.modelVersionId))
    .where(eq(forecastRuns.id, req.runId))
    .limit(1);
  if (!run) throw new DomainError(404, 'Forecast run not found');
  if (run.status !== 'succeeded' && run.status !== 'partial') throw new DomainError(409, `Forecast run is ${run.status}`);

  // Resolve regions; cities use their district's forecast (CLIMATIQ never implies city-level precision).
  const parent = sql<string | null>`(select p.name from regions p where p.id = "regions"."parent_id")`;
  const parentCode = sql<string | null>`(select p.code from regions p where p.id = "regions"."parent_id")`;
  const requested = await db
    .select({ id: regions.id, code: regions.code, name: regions.name, level: regions.level, parentName: parent, parentCode, zone: regions.climateZone })
    .from(regions)
    .where(inArray(regions.code, codes));
  const missing = codes.filter((c) => !requested.some((r) => r.code === c));
  if (missing.length) throw new DomainError(400, `Unknown region code(s): ${missing.join(', ')}`);

  const notes: string[] = [];
  const effectiveCodes = new Set<string>();
  for (const r of requested) {
    if (r.level === 'city' && r.parentCode) {
      effectiveCodes.add(r.parentCode);
      notes.push(`${r.name} is a city; CLIMATIQ uses the ${r.parentName ?? 'parent'} district forecast (district-centroid resolution) for it.`);
    } else effectiveCodes.add(r.code);
  }
  const regionRows = await db
    .select({ id: regions.id, code: regions.code, name: regions.name, level: regions.level, parentName: parent, zone: regions.climateZone })
    .from(regions)
    .where(inArray(regions.code, [...effectiveCodes]));

  const fc = await db
    .select({
      regionId: forecasts.regionId,
      targetDate: forecasts.targetDate,
      horizonDay: forecasts.horizonDay,
      resolution: forecasts.resolution,
      predictedTmaxC: forecasts.predictedTmaxC,
      lowerC: forecasts.lowerC,
      upperC: forecasts.upperC,
      predictedTminC: forecasts.predictedTminC,
      normalTmaxC: forecasts.normalTmaxC,
      departureC: forecasts.departureC,
      severity: forecasts.severity,
      imdCategory: forecasts.imdCategory,
      confidence: forecasts.confidence,
      confidenceScore: forecasts.confidenceScore,
      durationDays: forecasts.durationDays,
      factors: forecasts.factors,
      inputKinds: forecasts.inputKinds,
    })
    .from(forecasts)
    .where(
      and(
        eq(forecasts.runId, run.id),
        inArray(forecasts.regionId, regionRows.map((r) => r.id)),
        gte(forecasts.horizonDay, 1),
        lte(forecasts.horizonDay, ADVISORY_HORIZON_DAYS),
      ),
    )
    .orderBy(asc(forecasts.targetDate));

  const bundleRegions: BundleRegion[] = [];
  const kinds = new Set<string>();
  for (const r of regionRows) {
    const rows = fc.filter((f) => f.regionId === r.id);
    if (!rows.length) throw new DomainError(422, `No CLIMATIQ forecast for ${r.name} in this run`);
    const days: BundleDay[] = rows.map((f) => ({
      targetDate: f.targetDate,
      horizonDay: f.horizonDay,
      predictedTmaxC: f.predictedTmaxC,
      lowerC: f.lowerC,
      upperC: f.upperC,
      predictedTminC: f.predictedTminC,
      normalTmaxC: f.normalTmaxC,
      departureC: f.departureC,
      severity: f.severity,
      imdCriteria: f.imdCategory as BundleDay['imdCriteria'],
      confidence: f.confidence,
      confidenceScore: f.confidenceScore,
      durationDays: f.durationDays,
    }));
    const peak = pickPeak(days);
    const peakRow = rows.find((f) => f.targetDate === peak.targetDate)!;
    for (const k of peakRow.inputKinds) kinds.add(k);
    for (const f of rows) for (const k of f.inputKinds) kinds.add(k);
    bundleRegions.push({
      code: r.code,
      name: r.name,
      level: r.level,
      parentName: r.parentName,
      climateZone: r.zone,
      resolution: peakRow.resolution,
      peak,
      days,
      factors: peakRow.factors.slice(0, 20).map((x) => ({ key: x.key, label: x.label, value: x.value, impact: x.impact, detail: x.detail })),
      inputKinds: peakRow.inputKinds,
    });
  }
  bundleRegions.sort((a, b) => sevRank(b.peak.severity) - sevRank(a.peak.severity) || b.peak.predictedTmaxC - a.peak.predictedTmaxC);

  const top = bundleRegions[0];
  const allDates = bundleRegions.flatMap((r) => r.days.map((d) => d.targetDate)).sort();
  const departures = bundleRegions.map((r) => r.peak.departureC).filter((d): d is number => d != null);
  const window = { from: allDates[0], to: allDates[allDates.length - 1], days: new Set(allDates).size };

  // Official warnings are only counted if a verified record exists for these regions/dates (none are ingested today).
  const [ow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(officialWarnings)
    .where(
      and(
        inArray(officialWarnings.regionId, regionRows.map((r) => r.id)),
        eq(officialWarnings.verified, true),
        sql`${officialWarnings.validTo} >= ${window.from}::date and ${officialWarnings.validFrom} <= (${window.to}::date + 1)`,
      ),
    );
  const owCount = Number(ow?.n ?? 0);

  const nwpInput = typeof run.inputs?.nwp === 'string' ? run.inputs.nwp : '';
  const sources = await dataSourcesFor(db, run.scenario, kinds, /previous runs/i.test(nwpInput));

  if (run.scenario === 'replay') {
    notes.push(
      `This is a historical replay of the late-May 2024 heatwave: CLIMATIQ hindcasts issued as of ${run.issuedFor} from ERA5 reanalysis history${/previous runs/i.test(nwpInput) ? ' and NWP guidance as it was issued at the time' : ''}. It is not a current forecast or emergency.`,
    );
  }
  if (![...kinds].includes('nwp_forecast')) {
    notes.push('No numerical weather prediction guidance was used in this run; forecasts rely on recent-heat persistence and reference climatology, which widens uncertainty.');
  }
  notes.push('Reference normals are a 5-year ERA5-based climatology, not IMD official 30-year normals.');
  notes.push('Confidence is a heuristic score derived from the uncertainty band — it is not a calibrated probability.');

  const bundle: ForecastBundle = {
    bundleVersion: 'forecast-bundle-v1',
    builtAt: new Date().toISOString(),
    audience: req.audience,
    run: {
      id: run.id,
      scenario: run.scenario,
      scenarioLabel: SCENARIO_LABELS[run.scenario],
      issuedFor: run.issuedFor,
      horizonDays: run.horizonDays,
      isHindcast: run.isHindcast,
      modelKey: run.modelKey,
      modelName: run.modelName,
      createdAt: run.createdAt.toISOString(),
      inputs: Object.fromEntries(Object.entries(run.inputs ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
    },
    window,
    summary: {
      peakSeverity: top.peak.severity,
      peakRegionCode: top.code,
      peakDate: top.peak.targetDate,
      peakTmaxC: top.peak.predictedTmaxC,
      maxDepartureC: departures.length ? Math.max(...departures) : null,
      maxDurationDays: Math.max(...bundleRegions.map((r) => r.peak.durationDays)),
      confidence: top.peak.confidence,
      confidenceScore: top.peak.confidenceScore,
      regionsAtOrAboveHigh: bundleRegions.filter((r) => sevRank(r.peak.severity) >= sevRank('high')).length,
    },
    regions: bundleRegions,
    dataSources: sources,
    officialWarnings: {
      count: owCount,
      note:
        owCount > 0
          ? `${owCount} verified official warning record(s) exist for these regions; they are shown separately and must not be restated as CLIMATIQ content.`
          : 'No verified official (IMD) warnings are available to CLIMATIQ for these regions and dates. Do not state or imply that any official warning exists.',
    },
    notes,
  };
  return ForecastBundleSchema.parse(bundle);
}

/** Maps the input data kinds of the forecasts to registered data sources (+ the CLIMATIQ model itself). */
async function dataSourcesFor(db: DB, scenario: 'live' | 'replay', kinds: Set<string>, nwpFromPreviousRuns: boolean): Promise<BundleSource[]> {
  const wanted: { key: string; dataKind: BundleSource['dataKind']; role: string }[] = [
    { key: SOURCE_KEYS.baseline, dataKind: 'model_forecast', role: 'CLIMATIQ baseline forecast (Tmax, band, severity, confidence)' },
  ];
  if (kinds.has('reanalysis') || kinds.has('climatology')) {
    wanted.push({
      key: SOURCE_KEYS.openMeteoArchive,
      dataKind: 'reanalysis',
      role: scenario === 'replay' ? 'ERA5 reanalysis history and reference climatology (replay inputs)' : 'ERA5 reanalysis history and reference climatology',
    });
  }
  if (kinds.has('nwp_forecast')) {
    wanted.push(
      nwpFromPreviousRuns
        ? { key: SOURCE_KEYS.openMeteoPreviousRuns, dataKind: 'nwp_forecast', role: 'Archived NWP guidance exactly as issued before each target day (no hindsight)' }
        : { key: SOURCE_KEYS.openMeteoForecast, dataKind: 'nwp_forecast', role: 'Numerical weather prediction guidance blended into the forecast' },
    );
  }
  if (kinds.has('simulated')) wanted.push({ key: SOURCE_KEYS.simulator, dataKind: 'simulated', role: 'Simulated fallback history (offline demo data)' });
  const rows = await db.select().from(dataSources).where(inArray(dataSources.key, wanted.map((w) => w.key)));
  const out: BundleSource[] = [];
  for (const w of wanted) {
    const r = rows.find((x) => x.key === w.key);
    if (r) out.push({ key: r.key, name: r.name, sourceKind: r.kind, dataKind: w.dataKind, url: r.url, attribution: r.attribution, role: w.role });
  }
  return out;
}
