/**
 * Pure alert rules (no DB) — unit-testable.
 *
 * Rule: a forecast row qualifies when
 *   severity ≥ alerts.min_severity  AND  confidence_score ≥ alerts.min_confidence  AND  1 ≤ horizon_day ≤ alerts.max_horizon_days.
 *
 * Aggregation (one alert per region per run):
 *   - For each region, the qualifying rows are collapsed to the PEAK day (highest severity, then highest Tmax, then
 *     earliest date). The alert carries that day's target date, severity and forecast id; the message mentions the
 *     spell length from that day.
 *   - Granularity: pilot districts raise district-level alerts. A state raises a state-level alert only when the run
 *     has no district forecasts for it (non-pilot states), so pilot states are not double-alerted.
 * Dedup key: `${scenario}:${regionCode}:${targetDate}:${severity}` (unique among open alerts in the DB).
 */
import { SEVERITY_META, type Severity } from '@/lib/domain';

export type AlertConfig = { minSeverity: Severity; minConfidence: number; maxHorizonDays: number; cooldownHours: number };

export const DEFAULT_ALERT_CONFIG: AlertConfig = { minSeverity: 'high', minConfidence: 0.45, maxHorizonDays: 5, cooldownHours: 24 };

export type AlertForecastRow = {
  forecastId: number;
  regionId: number;
  code: string;
  name: string;
  level: 'country' | 'state' | 'district' | 'city';
  parentId: number | null;
  path: string;
  targetDate: string;
  horizonDay: number;
  severity: Severity;
  confidence: 'low' | 'medium' | 'high';
  confidenceScore: number;
  predictedTmaxC: number;
  lowerC: number;
  upperC: number;
  normalTmaxC: number | null;
  departureC: number | null;
  durationDays: number;
  resolution: string;
};

export type AlertCandidate = AlertForecastRow & { qualifyingDays: number; granularity: 'district' | 'state' };

const rank = (s: Severity) => SEVERITY_META[s].rank;

export function qualifies(row: Pick<AlertForecastRow, 'severity' | 'confidenceScore' | 'horizonDay'>, cfg: AlertConfig): boolean {
  return (
    rank(row.severity) >= rank(cfg.minSeverity) &&
    row.confidenceScore >= cfg.minConfidence &&
    row.horizonDay >= 1 &&
    row.horizonDay <= cfg.maxHorizonDays
  );
}

export function dedupKey(scenario: string, regionCode: string, targetDate: string, severity: Severity) {
  return `${scenario}:${regionCode}:${targetDate}:${severity}`;
}

/**
 * @param statesWithDistricts ids of states that have district-level forecasts in the run (pilot states).
 */
export function aggregateCandidates(rows: AlertForecastRow[], cfg: AlertConfig, statesWithDistricts: Set<number>): AlertCandidate[] {
  const byRegion = new Map<number, AlertForecastRow[]>();
  for (const r of rows) {
    if (!qualifies(r, cfg)) continue;
    if (r.level === 'state' && statesWithDistricts.has(r.regionId)) continue; // covered by district alerts
    if (r.level !== 'state' && r.level !== 'district') continue; // cities inherit district forecasts; no country alerts
    const list = byRegion.get(r.regionId) ?? [];
    list.push(r);
    byRegion.set(r.regionId, list);
  }
  const out: AlertCandidate[] = [];
  for (const list of byRegion.values()) {
    const peak = list.reduce((best, r) => {
      const d = rank(r.severity) - rank(best.severity);
      if (d !== 0) return d > 0 ? r : best;
      if (r.predictedTmaxC !== best.predictedTmaxC) return r.predictedTmaxC > best.predictedTmaxC ? r : best;
      return r.targetDate < best.targetDate ? r : best;
    });
    out.push({ ...peak, qualifyingDays: list.length, granularity: peak.level === 'district' ? 'district' : 'state' });
  }
  return out.sort((a, b) => rank(b.severity) - rank(a.severity) || b.predictedTmaxC - a.predictedTmaxC);
}

/** Parses `app_config` values defensively (bad values fall back to defaults). */
export function parseAlertConfig(values: Record<string, unknown>): AlertConfig {
  const sev = values['alerts.min_severity'];
  const num = (k: string, def: number, min: number, max: number) => {
    const v = Number(values[k]);
    return Number.isFinite(v) && v >= min && v <= max ? v : def;
  };
  return {
    minSeverity: typeof sev === 'string' && sev in SEVERITY_META ? (sev as Severity) : DEFAULT_ALERT_CONFIG.minSeverity,
    minConfidence: num('alerts.min_confidence', DEFAULT_ALERT_CONFIG.minConfidence, 0, 1),
    maxHorizonDays: Math.round(num('alerts.max_horizon_days', DEFAULT_ALERT_CONFIG.maxHorizonDays, 1, 16)),
    cooldownHours: num('alerts.cooldown_hours', DEFAULT_ALERT_CONFIG.cooldownHours, 0, 24 * 30),
  };
}
