/**
 * Pure aggregation helpers for CLIMATIQ analytics (no database access — unit-testable).
 *
 * Accuracy conventions
 *   error = predicted − observed (°C), so a positive bias means the model ran warm.
 *   MAE   = mean |error|, RMSE = sqrt(mean error²), bias = mean error.
 *   "Observed" in this prototype is ERA5 reanalysis (not station truth) — callers must say so.
 */
import { dayOfYear } from '../forecasting/baseline';
import { classify, DEFAULT_THRESHOLDS, type ClimateZone, type ZoneThresholds } from '../forecasting/severity';
import { SEVERITIES, type Severity } from '@/lib/domain';

export type ErrorStats = { n: number; mae: number; rmse: number; bias: number; maxAbs: number };

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** MAE / RMSE / bias for a list of errors (predicted − observed). Null when there are no finite errors. */
export function errorStats(errors: number[]): ErrorStats | null {
  const e = errors.filter((x) => Number.isFinite(x));
  if (!e.length) return null;
  let abs = 0;
  let sq = 0;
  let sum = 0;
  let maxAbs = 0;
  for (const x of e) {
    abs += Math.abs(x);
    sq += x * x;
    sum += x;
    maxAbs = Math.max(maxAbs, Math.abs(x));
  }
  return { n: e.length, mae: round(abs / e.length), rmse: round(Math.sqrt(sq / e.length)), bias: round(sum / e.length), maxAbs: round(maxAbs) };
}

export function groupBy<T, K extends string | number>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const rank = (s: Severity) => SEVERITIES.indexOf(s);

export type Confusion = {
  /** matrix[predicted][observed] counts, indices follow SEVERITIES (low → extreme). */
  matrix: number[][];
  n: number;
  exact: number;
  exactRate: number | null;
  withinOne: number;
  withinOneRate: number | null;
  /** Event = severity ≥ High (meets IMD heatwave criteria as evaluated by CLIMATIQ). */
  event: { hits: number; misses: number; falseAlarms: number; correctNegatives: number; pod: number | null; far: number | null; csi: number | null };
};

/** Severity hit/miss table and event scores (POD, FAR, CSI) for "≥ High" heat events. */
export function confusion(pairs: { predicted: Severity; observed: Severity }[], eventMin: Severity = 'high'): Confusion {
  const matrix = SEVERITIES.map(() => SEVERITIES.map(() => 0));
  let exact = 0;
  let withinOne = 0;
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  let correctNegatives = 0;
  for (const p of pairs) {
    const pi = rank(p.predicted);
    const oi = rank(p.observed);
    if (pi < 0 || oi < 0) continue;
    matrix[pi][oi] += 1;
    if (pi === oi) exact += 1;
    if (Math.abs(pi - oi) <= 1) withinOne += 1;
    const pe = pi >= rank(eventMin);
    const oe = oi >= rank(eventMin);
    if (pe && oe) hits += 1;
    else if (!pe && oe) misses += 1;
    else if (pe && !oe) falseAlarms += 1;
    else correctNegatives += 1;
  }
  const n = hits + misses + falseAlarms + correctNegatives;
  const ratio = (a: number, b: number) => (b > 0 ? round(a / b, 3) : null);
  return {
    matrix,
    n,
    exact,
    exactRate: ratio(exact, n),
    withinOne,
    withinOneRate: ratio(withinOne, n),
    event: {
      hits,
      misses,
      falseAlarms,
      correctNegatives,
      pod: ratio(hits, hits + misses),
      far: ratio(falseAlarms, hits + falseAlarms),
      csi: ratio(hits, hits + misses + falseAlarms),
    },
  };
}

export type VerificationPoint = {
  regionId: number;
  regionCode: string;
  regionName: string;
  level: string;
  horizonDay: number;
  predictedTmaxC: number;
  lowerC: number;
  upperC: number;
  observedTmaxC: number;
  errorC: number;
  predictedSeverity: Severity;
  observedSeverity: Severity;
  modelKey: string;
};

export type RegionAccuracy = ErrorStats & { regionId: number; regionCode: string; regionName: string; level: string };

export type AccuracySummary = {
  overall: ErrorStats | null;
  /** Share of observations inside the nominal 80 % band (empirical coverage). */
  bandCoverage: { inside: number; n: number; rate: number | null };
  byHorizon: (ErrorStats & { horizonDay: number })[];
  byLevel: (ErrorStats & { level: string })[];
  byRegion: RegionAccuracy[];
  byModel: (ErrorStats & { modelKey: string; bandCoverageRate: number | null })[];
  confusion: Confusion;
};

export function summariseAccuracy(points: VerificationPoint[]): AccuracySummary {
  const err = (rs: VerificationPoint[]) => rs.map((r) => r.errorC);
  const inside = points.filter((p) => p.observedTmaxC >= p.lowerC && p.observedTmaxC <= p.upperC).length;
  const byHorizon = [...groupBy(points, (p) => p.horizonDay)]
    .map(([horizonDay, rs]) => ({ horizonDay, ...errorStats(err(rs))! }))
    .sort((a, b) => a.horizonDay - b.horizonDay);
  const byLevel = [...groupBy(points, (p) => p.level)].map(([level, rs]) => ({ level, ...errorStats(err(rs))! }));
  const byRegion = [...groupBy(points, (p) => p.regionId)]
    .map(([regionId, rs]) => ({ regionId, regionCode: rs[0].regionCode, regionName: rs[0].regionName, level: rs[0].level, ...errorStats(err(rs))! }))
    .sort((a, b) => a.mae - b.mae || a.regionName.localeCompare(b.regionName));
  const byModel = [...groupBy(points, (p) => p.modelKey)].map(([modelKey, rs]) => {
    const ins = rs.filter((p) => p.observedTmaxC >= p.lowerC && p.observedTmaxC <= p.upperC).length;
    return { modelKey, ...errorStats(err(rs))!, bandCoverageRate: rs.length ? round(ins / rs.length, 3) : null };
  });
  return {
    overall: errorStats(err(points)),
    bandCoverage: { inside, n: points.length, rate: points.length ? round(inside / points.length, 3) : null },
    byHorizon,
    byLevel,
    byRegion,
    byModel,
    confusion: confusion(points.map((p) => ({ predicted: p.predictedSeverity, observed: p.observedSeverity }))),
  };
}

// ─────────────────────────── Time-series helpers ───────────────────────────

const DAY_MS = 86_400_000;
export const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/**
 * Trailing calendar-window mean (e.g. 30-day rolling mean). A value is produced only when at least `minCount`
 * non-null observations fall inside the window, so seasonal gaps never produce misleading means.
 * Input must be sorted by day.
 */
export function rollingMean(points: { day: string; value: number | null }[], window = 30, minCount = Math.ceil(window * 2 / 3)): (number | null)[] {
  const out: (number | null)[] = [];
  const t = points.map((p) => dayMs(p.day));
  let start = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < points.length; i++) {
    const v = points[i].value;
    if (v != null && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
    while (t[i] - t[start] >= window * DAY_MS) {
      const old = points[start].value;
      if (old != null && Number.isFinite(old)) {
        sum -= old;
        count -= 1;
      }
      start += 1;
    }
    out.push(count >= minCount ? round(sum / count, 2) : null);
  }
  return out;
}

export type HeatYear = { year: number; daysEvaluated: number; moderate: number; high: number; extreme: number; heatwaveDays: number; maxTmaxC: number | null };

/**
 * Counts days meeting CLIMATIQ severity classes per calendar year, by applying `classify` (IMD-criteria-derived
 * thresholds) to each day's Tmax against the reference normal for its day-of-year. Days without a normal are
 * still classified (absolute criteria only) but counted in `daysEvaluated` only when a normal exists — callers
 * should state this is an indicator, not an IMD declaration (no 2-station / 2-consecutive-day rule).
 */
export function heatDaysByYear(
  days: { day: string; tmaxC: number | null }[],
  normals: Map<number, number>,
  zone: ClimateZone,
  thresholds: ZoneThresholds = DEFAULT_THRESHOLDS,
): HeatYear[] {
  const years = new Map<number, HeatYear>();
  for (const d of days) {
    if (d.tmaxC == null || !Number.isFinite(d.tmaxC)) continue;
    const year = Number(d.day.slice(0, 4));
    const y = years.get(year) ?? { year, daysEvaluated: 0, moderate: 0, high: 0, extreme: 0, heatwaveDays: 0, maxTmaxC: null };
    const normal = normals.get(dayOfYear(d.day)) ?? null;
    if (normal == null) {
      years.set(year, y);
      continue;
    }
    y.daysEvaluated += 1;
    y.maxTmaxC = y.maxTmaxC == null ? d.tmaxC : Math.max(y.maxTmaxC, d.tmaxC);
    const { severity } = classify(d.tmaxC, normal, zone, thresholds);
    if (severity === 'moderate') y.moderate += 1;
    if (severity === 'high') y.high += 1;
    if (severity === 'extreme') y.extreme += 1;
    y.heatwaveDays = y.high + y.extreme;
    years.set(year, y);
  }
  return [...years.values()].sort((a, b) => a.year - b.year);
}

export type MonthCell = { year: number; month: number; mean: number; n: number; max: number };

/** Monthly mean (and max) Tmax per year; months with fewer than `minDays` values are dropped. */
export function monthlyMeans(days: { day: string; tmaxC: number | null }[], minDays = 10): MonthCell[] {
  const acc = new Map<string, { year: number; month: number; sum: number; n: number; max: number }>();
  for (const d of days) {
    if (d.tmaxC == null || !Number.isFinite(d.tmaxC)) continue;
    const year = Number(d.day.slice(0, 4));
    const month = Number(d.day.slice(5, 7));
    const k = `${year}-${month}`;
    const a = acc.get(k) ?? { year, month, sum: 0, n: 0, max: -Infinity };
    a.sum += d.tmaxC;
    a.n += 1;
    a.max = Math.max(a.max, d.tmaxC);
    acc.set(k, a);
  }
  return [...acc.values()]
    .filter((a) => a.n >= minDays)
    .map((a) => ({ year: a.year, month: a.month, mean: round(a.sum / a.n, 1), n: a.n, max: round(a.max, 1) }))
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

/** Simple descriptive stats for a region/window (null-safe). */
export function describe(values: (number | null)[]): { n: number; mean: number | null; p95: number | null; max: number | null; min: number | null } {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: null, p95: null, max: null, min: null };
  const q = (p: number) => {
    const idx = (v.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return v[lo] + (v[hi] - v[lo]) * (idx - lo);
  };
  return { n: v.length, mean: round(v.reduce((a, b) => a + b, 0) / v.length, 1), p95: round(q(0.95), 1), max: v.at(-1)!, min: v[0] };
}
