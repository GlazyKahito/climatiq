/**
 * CLIMATIQ heat-risk severity classification.
 *
 * The four CLIMATIQ levels are DERIVED FROM the IMD heatwave criteria but are not IMD categories:
 *   extreme  ⇐ IMD "severe heat wave" criteria
 *   high     ⇐ IMD "heat wave" criteria
 *   moderate ⇐ CLIMATIQ-configured "approaching heatwave" band
 *   low      ⇐ otherwise
 * Departures are computed against CLIMATIQ's 5-year reference climatology, not IMD's official normals,
 * so results are an approximation of the IMD criteria. Thresholds are configurable (severity_thresholds table).
 */
import type { Severity } from '@/lib/domain';

export type ClimateZone = 'plains' | 'coastal' | 'hilly';

export type Threshold = {
  level: Severity;
  minTmaxC: number | null;
  minDepartureC: number | null;
  absoluteTmaxC: number | null;
};

export type ZoneThresholds = Record<ClimateZone, Threshold[]>;

/** Defaults mirroring the seeded `severity_thresholds` rows. */
export const DEFAULT_THRESHOLDS: ZoneThresholds = (['plains', 'coastal', 'hilly'] as const).reduce((acc, zone) => {
  const base = zone === 'plains' ? 40 : zone === 'coastal' ? 37 : 30;
  acc[zone] = [
    { level: 'extreme', minTmaxC: base, minDepartureC: 6.5, absoluteTmaxC: zone === 'plains' ? 47 : null },
    { level: 'high', minTmaxC: base, minDepartureC: 4.5, absoluteTmaxC: zone === 'plains' ? 45 : null },
    { level: 'moderate', minTmaxC: base, minDepartureC: 2.5, absoluteTmaxC: null },
    { level: 'low', minTmaxC: null, minDepartureC: null, absoluteTmaxC: null },
  ];
  return acc;
}, {} as ZoneThresholds);

export type Classification = {
  severity: Severity;
  imdCategory: 'none' | 'heatwave' | 'severe_heatwave';
  reason: string;
};

const ORDER: Severity[] = ['extreme', 'high', 'moderate', 'low'];

export function classify(
  tmaxC: number,
  normalTmaxC: number | null,
  zone: ClimateZone,
  thresholds: ZoneThresholds = DEFAULT_THRESHOLDS,
): Classification {
  const departure = normalTmaxC == null ? null : tmaxC - normalTmaxC;
  const rules = [...thresholds[zone]].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  for (const r of rules) {
    if (r.level === 'low') break;
    const absoluteHit = r.absoluteTmaxC != null && tmaxC >= r.absoluteTmaxC;
    const departureHit =
      r.minTmaxC != null && tmaxC >= r.minTmaxC && departure != null && r.minDepartureC != null && departure >= r.minDepartureC;
    if (absoluteHit || departureHit) {
      const imdCategory = r.level === 'extreme' ? 'severe_heatwave' : r.level === 'high' ? 'heatwave' : 'none';
      const reason = absoluteHit
        ? `Tmax ${tmaxC.toFixed(1)} °C ≥ ${r.absoluteTmaxC} °C absolute ${zone} threshold`
        : `Tmax ${tmaxC.toFixed(1)} °C ≥ ${r.minTmaxC} °C and ${departure!.toFixed(1)} °C above the reference normal (≥ ${r.minDepartureC} °C)`;
      return { severity: r.level, imdCategory, reason };
    }
  }
  const base = thresholds[zone].find((t) => t.level === 'moderate')?.minTmaxC;
  return {
    severity: 'low',
    imdCategory: 'none',
    reason:
      base != null && tmaxC < base
        ? `Tmax ${tmaxC.toFixed(1)} °C is below the ${base} °C ${zone} heatwave base threshold`
        : departure == null
          ? 'No reference normal available — absolute thresholds not reached'
          : `Departure of ${departure.toFixed(1)} °C is below heat-risk thresholds`,
  };
}

/** Number of consecutive days, starting at `fromIndex`, at or above `min` severity. */
export function heatSpellLength(severities: Severity[], fromIndex: number, min: Severity = 'high'): number {
  const rank = (s: Severity) => ['low', 'moderate', 'high', 'extreme'].indexOf(s);
  let n = 0;
  for (let i = fromIndex; i < severities.length && rank(severities[i]) >= rank(min); i++) n++;
  return n;
}
