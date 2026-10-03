/**
 * CSV builders for /api/v1/export/*.csv. Column names carry units (`_c` = °C, `_pct`, `_kmh`, `_mj`), every row
 * carries its provenance (`data_kind`, `source`) and timestamps are ISO-8601 UTC.
 */
import type { DB } from '../db/types';
import { csvFilename, toCsv, type CsvValue } from './csv';
import { getRunDetail, runExportRows } from './forecast-views';
import { verificationRows } from './accuracy';
import { climateSeries } from './history';
import { filterByScopes } from './params';
import type { RegionSummary } from '../geo/regions';

export type CsvFile = { filename: string; body: string; rows: number };

const BAND_NOTE = 'nominal 80% heuristic band (uncalibrated)';
const CONF_NOTE = 'heuristic score 0-1, not a probability';

export const FORECAST_COLUMNS = [
  'run_id',
  'model_version',
  'scenario',
  'is_hindcast',
  'issued_for',
  'run_generated_at',
  'region_code',
  'region_name',
  'level',
  'parent_code',
  'climate_zone',
  'lat',
  'lon',
  'resolution',
  'target_date',
  'horizon_day',
  'predicted_tmax_c',
  'lower_c',
  'upper_c',
  'interval_note',
  'predicted_tmin_c',
  'nwp_tmax_c',
  'normal_tmax_c',
  'normal_basis',
  'departure_c',
  'severity',
  'imd_criteria_category',
  'confidence',
  'confidence_score',
  'confidence_note',
  'duration_days_ge_high',
  'input_kinds',
  'data_kind',
  'source',
  'official',
  'exported_at',
];

export async function forecastsCsv(db: DB, runId: string, scopes: (string | null)[], now = new Date()): Promise<CsvFile | null> {
  const run = await getRunDetail(db, runId);
  if (!run) return null;
  const rows = filterByScopes(await runExportRows(db, runId), scopes);
  const basis = typeof run.inputs.normals === 'string' ? run.inputs.normals : typeof run.params.normalsBasis === 'string' ? run.params.normalsBasis : null;
  const created = new Date(run.createdAt);
  const data: CsvValue[][] = rows.map((r) => [
    run.id,
    run.modelKey,
    run.scenario,
    run.isHindcast,
    run.issuedFor,
    created,
    r.code,
    r.name,
    r.level,
    r.parentCode,
    r.climateZone,
    r.lat,
    r.lon,
    r.resolution,
    r.targetDate,
    r.horizonDay,
    r.predictedTmaxC,
    r.lowerC,
    r.upperC,
    BAND_NOTE,
    r.predictedTminC,
    r.nwpTmaxC,
    r.normalTmaxC,
    basis,
    r.departureC,
    r.severity,
    r.imdCategory,
    r.confidence,
    r.confidenceScore,
    CONF_NOTE,
    r.durationDays,
    (r.inputKinds ?? []).join('|'),
    'model_forecast',
    `CLIMATIQ ${run.modelKey}`,
    false,
    now,
  ]);
  return {
    filename: csvFilename('climatiq', 'forecasts', run.scenario, run.issuedFor, run.id.slice(0, 8)),
    body: toCsv(FORECAST_COLUMNS, data),
    rows: data.length,
  };
}

export const HISTORY_COLUMNS = [
  'region_code',
  'region_name',
  'level',
  'lat',
  'lon',
  'day',
  'tmax_c',
  'tmin_c',
  'apparent_tmax_c',
  'rh_mean_pct',
  'wind_max_kmh',
  'radiation_mj_m2',
  'data_kind',
  'source',
  'record_updated_at',
  'exported_at',
];

export async function historyCsv(db: DB, region: RegionSummary, from: string, to: string, now = new Date()): Promise<CsvFile> {
  const rows = await climateSeries(db, [region.id], from, to);
  const data: CsvValue[][] = rows.map((r) => [
    region.code,
    region.name,
    region.level,
    region.lat,
    region.lon,
    r.day,
    r.tmaxC,
    r.tminC,
    r.apparentTmaxC,
    r.rhMeanPct,
    r.windMaxKmh,
    r.radiationMj,
    r.dataKind,
    r.sourceName,
    new Date(r.updatedAt),
    now,
  ]);
  return { filename: csvFilename('climatiq', 'history', region.code, from, to), body: toCsv(HISTORY_COLUMNS, data), rows: data.length };
}

export const VERIFICATION_COLUMNS = [
  'run_id',
  'model_version',
  'scenario',
  'is_hindcast',
  'issued_for',
  'region_code',
  'region_name',
  'level',
  'target_date',
  'horizon_day',
  'predicted_tmax_c',
  'lower_c',
  'upper_c',
  'observed_tmax_c',
  'observed_kind',
  'truth_source',
  'error_c',
  'abs_error_c',
  'within_band',
  'predicted_severity',
  'observed_severity',
  'severity_exact_match',
  'evaluated_at',
  'exported_at',
];

export async function verificationCsv(db: DB, runId: string, scopes: (string | null)[], now = new Date()): Promise<CsvFile | null> {
  const run = await getRunDetail(db, runId);
  if (!run) return null;
  const rows = filterByScopes(await verificationRows(db, { runIds: [runId] }), scopes);
  const data: CsvValue[][] = rows.map((r) => [
    r.runId,
    r.modelKey,
    r.scenario,
    r.isHindcast,
    r.issuedFor,
    r.regionCode,
    r.regionName,
    r.level,
    r.targetDate,
    r.horizonDay,
    r.predictedTmaxC,
    r.lowerC,
    r.upperC,
    r.observedTmaxC,
    r.observedKind,
    r.observedKind === 'reanalysis' ? 'ERA5 reanalysis via Open-Meteo archive (not station observations)' : r.observedKind,
    r.errorC,
    Math.round(Math.abs(r.errorC) * 100) / 100,
    r.observedTmaxC >= r.lowerC && r.observedTmaxC <= r.upperC,
    r.predictedSeverity,
    r.observedSeverity,
    r.predictedSeverity === r.observedSeverity,
    new Date(r.evaluatedAt),
    now,
  ]);
  return {
    filename: csvFilename('climatiq', 'verification', run.scenario, run.issuedFor, run.id.slice(0, 8)),
    body: toCsv(VERIFICATION_COLUMNS, data),
    rows: data.length,
  };
}
