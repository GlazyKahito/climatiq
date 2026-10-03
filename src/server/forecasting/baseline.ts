/**
 * baseline-v1 — transparent statistical heat forecast.
 *
 *   normal(d)      5-year reference climatology for the target day-of-year
 *   anomaly0       mean(Tmax over the last 3 available days) − mean(normal over those days)
 *   persistence(h) normal(d+h) + anomaly0 · e^(−h/τ),  τ = 3 days
 *   prediction(h)  w_h · NWP(h) + (1 − w_h) · persistence(h),  w_h = 0.85 − 0.05·(h−1) (min 0.55); w = 0 without NWP
 *   σ(h)           0.9 + 0.3·h + 0.25·min(|NWP(h) − persistence(h)|, 6)  (+0.8 without NWP)
 *   interval       prediction ± 1.28σ  — nominal 80 % band from a heuristic σ, NOT calibrated
 *
 * Confidence label/score are heuristics derived from σ and input completeness and must not be read as probabilities.
 */
import type { ForecastFactor } from '../db/schema';
import { classify, heatSpellLength, type ClimateZone, type ZoneThresholds, DEFAULT_THRESHOLDS } from './severity';
import type { Confidence, Severity } from '@/lib/domain';

export const MODEL_KEY = 'baseline-v1';
const TAU = 3;

export type DayInput = { day: string; tmaxC: number | null; tminC?: number | null; rhMeanPct?: number | null; windMaxKmh?: number | null; radiationMj?: number | null };

export type RegionInputs = {
  regionId: number;
  zone: ClimateZone;
  resolution: string;
  /** Recent history (observed/reanalysis), most recent last, up to and including day 0 if available. */
  history: DayInput[];
  /** NWP guidance per target day (may be empty). */
  nwp: DayInput[];
  /** Reference normal Tmax/Tmin by day-of-year (1..366). */
  normals: Map<number, { tmax: number; tmin: number | null }>;
  historyKind: 'reanalysis' | 'observed' | 'simulated';
  nwpKind?: 'nwp_forecast' | 'simulated';
};

export type ForecastPoint = {
  regionId: number;
  targetDate: string;
  horizonDay: number;
  resolution: string;
  predictedTmaxC: number;
  lowerC: number;
  upperC: number;
  predictedTminC: number | null;
  nwpTmaxC: number | null;
  normalTmaxC: number | null;
  departureC: number | null;
  severity: Severity;
  imdCategory: 'none' | 'heatwave' | 'severe_heatwave';
  confidence: Confidence;
  confidenceScore: number;
  durationDays: number;
  factors: ForecastFactor[];
  inputKinds: string[];
};

export function dayOfYear(day: string): number {
  const d = new Date(`${day}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86_400_000);
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function confidenceFrom(sigma: number, hasNwp: boolean): { label: Confidence; score: number } {
  const score = Math.max(0.05, Math.min(0.95, 1 - (sigma - 0.9) / 4.5 - (hasNwp ? 0 : 0.1)));
  const label: Confidence = score >= 0.6 ? 'high' : score >= 0.4 ? 'medium' : 'low';
  return { label, score: Math.round(score * 100) / 100 };
}

/** Produces a horizon-length forecast for one region, issued as of `issuedFor` (day 0). */
export function forecastRegion(
  inputs: RegionInputs,
  issuedFor: string,
  horizonDays: number,
  thresholds: ZoneThresholds = DEFAULT_THRESHOLDS,
): ForecastPoint[] {
  const hist = inputs.history.filter((h) => h.day <= issuedFor && h.tmaxC != null).slice(-3);
  const normalFor = (day: string) => inputs.normals.get(dayOfYear(day)) ?? null;

  let anomaly0 = 0;
  if (hist.length) {
    const anomalies = hist
      .map((h) => {
        const n = normalFor(h.day);
        return n ? (h.tmaxC as number) - n.tmax : null;
      })
      .filter((a): a is number => a != null);
    anomaly0 = anomalies.length ? anomalies.reduce((a, b) => a + b, 0) / anomalies.length : 0;
  }
  const lastTmin = hist.at(-1)?.tminC ?? null;

  const draft = [] as Omit<ForecastPoint, 'durationDays'>[];
  for (let h = 1; h <= horizonDays; h++) {
    const target = addDays(issuedFor, h);
    const normal = normalFor(target);
    const nwp = inputs.nwp.find((n) => n.day === target);
    const nwpTmax = nwp?.tmaxC ?? null;
    const decay = Math.exp(-h / TAU);
    const persistence = normal ? normal.tmax + anomaly0 * decay : (hist.at(-1)?.tmaxC ?? nwpTmax ?? 30);
    const w = nwpTmax != null ? Math.max(0.55, 0.85 - 0.05 * (h - 1)) : 0;
    const pred = nwpTmax != null ? w * nwpTmax + (1 - w) * persistence : persistence;
    const sigma = 0.9 + 0.3 * h + (nwpTmax != null ? 0.25 * Math.min(Math.abs(nwpTmax - persistence), 6) : 0.8);
    const { label, score } = confidenceFrom(sigma, nwpTmax != null);

    const predTmin =
      nwp?.tminC != null
        ? nwp.tminC
        : normal?.tmin != null
          ? normal.tmin + (lastTmin != null && normal.tmin != null ? (lastTmin - normal.tmin) * decay : 0)
          : null;
    const departure = normal ? pred - normal.tmax : null;
    const cls = classify(pred, normal?.tmax ?? null, inputs.zone, thresholds);

    const factors: ForecastFactor[] = [];
    if (departure != null)
      factors.push({
        key: 'departure',
        label: 'Departure from reference normal',
        value: `${departure >= 0 ? '+' : ''}${departure.toFixed(1)} °C`,
        impact: departure >= 2.5 ? 'raises' : departure <= -1 ? 'lowers' : 'neutral',
        detail: `Reference normal for this date is ${normal!.tmax.toFixed(1)} °C (5-year ERA5-based climatology, not an official 30-year normal).`,
      });
    if (Math.abs(anomaly0) >= 1 && hist.length)
      factors.push({
        key: 'persistence',
        label: 'Recent heat persistence',
        value: `${anomaly0 >= 0 ? '+' : ''}${anomaly0.toFixed(1)} °C anomaly over the last ${hist.length} day(s)`,
        impact: anomaly0 > 0 ? 'raises' : 'lowers',
        detail: 'Recent anomalies tend to persist for a few days; the baseline lets them decay with a 3-day time scale.',
      });
    if (nwpTmax != null)
      factors.push({
        key: 'nwp',
        label: 'Numerical weather guidance',
        value: `${nwpTmax.toFixed(1)} °C`,
        impact: normal && nwpTmax - normal.tmax >= 2.5 ? 'raises' : 'neutral',
        detail: `Open-Meteo NWP guidance weighted at ${(w * 100).toFixed(0)} % for day ${h}.`,
      });
    else
      factors.push({
        key: 'nwp_missing',
        label: 'No NWP guidance',
        value: 'Persistence + climatology only',
        impact: 'neutral',
        detail: 'Without numerical guidance the forecast relies on persistence and climatology, widening the uncertainty band.',
      });
    if (nwp?.rhMeanPct != null && nwp.rhMeanPct < 30)
      factors.push({ key: 'dry_air', label: 'Dry air', value: `${nwp.rhMeanPct.toFixed(0)} % mean RH`, impact: 'raises', detail: 'Low humidity favours strong daytime heating.' });
    if (nwp?.rhMeanPct != null && nwp.rhMeanPct >= 60 && pred >= 35)
      factors.push({ key: 'humid_heat', label: 'Humid heat', value: `${nwp.rhMeanPct.toFixed(0)} % mean RH`, impact: 'raises', detail: 'High humidity raises heat stress (apparent temperature) even when Tmax is lower.' });
    if (nwp?.windMaxKmh != null && nwp.windMaxKmh < 12)
      factors.push({ key: 'weak_wind', label: 'Weak winds', value: `${nwp.windMaxKmh.toFixed(0)} km/h max`, impact: 'raises', detail: 'Light winds limit mixing and ventilation.' });
    if (nwp?.radiationMj != null && nwp.radiationMj >= 25)
      factors.push({ key: 'radiation', label: 'Strong sunshine', value: `${nwp.radiationMj.toFixed(1)} MJ/m²`, impact: 'raises', detail: 'High shortwave radiation load.' });
    if (predTmin != null && predTmin >= 30)
      factors.push({ key: 'warm_night', label: 'Warm night', value: `${predTmin.toFixed(1)} °C min`, impact: 'raises', detail: 'Little night-time relief increases cumulative heat stress.' });

    const inputKinds = [inputs.historyKind, 'climatology'];
    if (nwpTmax != null) inputKinds.push(inputs.nwpKind ?? 'nwp_forecast');

    draft.push({
      regionId: inputs.regionId,
      targetDate: target,
      horizonDay: h,
      resolution: inputs.resolution,
      predictedTmaxC: round1(pred),
      lowerC: round1(pred - 1.28 * sigma),
      upperC: round1(pred + 1.28 * sigma),
      predictedTminC: predTmin == null ? null : round1(predTmin),
      nwpTmaxC: nwpTmax == null ? null : round1(nwpTmax),
      normalTmaxC: normal ? round1(normal.tmax) : null,
      departureC: departure == null ? null : round1(departure),
      severity: cls.severity,
      imdCategory: cls.imdCategory,
      confidence: label,
      confidenceScore: score,
      factors: [
        { key: 'classification', label: 'Classification rule', value: cls.severity.toUpperCase(), impact: 'neutral', detail: cls.reason },
        ...factors,
      ],
      inputKinds,
    });
  }

  const sev = draft.map((d) => d.severity);
  return draft.map((d, i) => ({ ...d, durationDays: heatSpellLength(sev, i) }));
}

/** Builds a day-of-year climatology from multi-year daily history (±7-day window). */
export function buildNormals(history: DayInput[], window = 7): Map<number, { tmax: number; tmin: number | null; samples: number }> {
  const byDoy = new Map<number, { tmax: number[]; tmin: number[] }>();
  for (const h of history) {
    if (h.tmaxC == null) continue;
    const doy = dayOfYear(h.day);
    const e = byDoy.get(doy) ?? { tmax: [], tmin: [] };
    e.tmax.push(h.tmaxC);
    if (h.tminC != null) e.tmin.push(h.tminC);
    byDoy.set(doy, e);
  }
  const out = new Map<number, { tmax: number; tmin: number | null; samples: number }>();
  for (let doy = 1; doy <= 366; doy++) {
    const tmax: number[] = [];
    const tmin: number[] = [];
    for (let k = -window; k <= window; k++) {
      const d = ((doy - 1 + k + 366) % 366) + 1;
      const e = byDoy.get(d);
      if (e) {
        tmax.push(...e.tmax);
        tmin.push(...e.tmin);
      }
    }
    if (tmax.length) {
      out.set(doy, {
        tmax: tmax.reduce((a, b) => a + b, 0) / tmax.length,
        tmin: tmin.length ? tmin.reduce((a, b) => a + b, 0) / tmin.length : null,
        samples: tmax.length,
      });
    }
  }
  return out;
}

export { DEFAULT_THRESHOLDS };
export type { ClimateZone };
