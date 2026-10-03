/**
 * Server-side guardrails applied to EVERY advisory, whichever provider wrote it:
 *  - mandatory limitations (CLIMATIQ-generated, not IMD; replay notice; normals; resolution) are always present;
 *  - LLM output that mentions temperatures absent from the forecast bundle, or claims official warnings that do not
 *    exist, is rejected (the orchestrator then falls back to the deterministic template).
 */
import type { AdvisoryContent } from '../db/schema';
import { fmtDate } from '@/lib/domain';
import type { ForecastBundle } from './schema';

export function mandatoryLimitations(bundle: ForecastBundle): string[] {
  const out = [
    'CLIMATIQ-generated decision-support advisory — not an official IMD warning. Follow official IMD and state/district advisories wherever they are issued.',
  ];
  if (bundle.run.scenario === 'replay') {
    out.push(
      `Historical replay: CLIMATIQ hindcast issued as of ${fmtDate(bundle.run.issuedFor)} from past data (ERA5 reanalysis and archived guidance), shown for demonstration — not a current forecast or emergency.`,
    );
  }
  if (bundle.officialWarnings.count === 0) {
    out.push('No verified official warnings were available to CLIMATIQ for these regions and dates.');
  }
  out.push('Departures from normal use a 5-year ERA5-based reference climatology, not IMD official 30-year normals.');
  out.push('Forecasts are computed at district or state centroid resolution; they do not represent specific cities or neighbourhoods.');
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Adds any missing mandatory limitation (deduplicated, capped at the schema's 10 items). */
export function withMandatoryLimitations(content: AdvisoryContent, bundle: ForecastBundle): AdvisoryContent {
  const mandatory = mandatoryLimitations(bundle);
  const seen = new Set(mandatory.map(norm));
  const rest = content.limitations.filter((l) => !seen.has(norm(l)));
  return { ...content, limitations: [...mandatory, ...rest].slice(0, 10) };
}

/** Every numeric value a provider may legitimately quote in °C. */
function allowedTemperatures(bundle: ForecastBundle): number[] {
  const vals = new Set<number>([30, 37, 40, 45, 47, 2.5, 4.5, 6.5]); // published CLIMATIQ/IMD-derived thresholds
  for (const r of bundle.regions) {
    for (const d of [r.peak, ...r.days]) {
      for (const v of [d.predictedTmaxC, d.lowerC, d.upperC, d.predictedTminC, d.normalTmaxC, d.departureC]) {
        if (v != null) {
          vals.add(v);
          vals.add(Math.abs(v));
        }
      }
    }
    // Factor texts carry further bundle numbers (NWP guidance, normals, night minimum, recent anomaly …).
    for (const f of r.factors) for (const m of `${f.value} ${f.detail}`.matchAll(/\d+(?:\.\d+)?/g)) vals.add(Number(m[0]));
  }
  vals.add(bundle.summary.peakTmaxC);
  if (bundle.summary.maxDepartureC != null) vals.add(Math.abs(bundle.summary.maxDepartureC));
  return [...vals];
}

const TEMP_RANGE = /(\d{1,2}(?:\.\d+)?)\s*(?:–|—|-|to)\s*(\d{1,2}(?:\.\d+)?)\s*°\s*C/gi;
const TEMP_SINGLE = /(\d{1,2}(?:\.\d+)?)\s*(?:°\s*C|degrees?\s*(?:celsius|C)\b)/gi;

/** Temperatures (°C) mentioned in the text that do not match any bundle value. */
export function ungroundedTemperatures(content: AdvisoryContent, bundle: ForecastBundle): number[] {
  const text = [
    content.summary,
    content.forecastDetails,
    content.uncertainty,
    ...content.contributingFactors,
    ...content.limitations,
    ...content.recommendedActions.map((a) => a.action),
  ].join('\n');
  const found: string[] = [];
  for (const m of text.matchAll(TEMP_RANGE)) found.push(m[1], m[2]);
  for (const m of text.matchAll(TEMP_SINGLE)) found.push(m[1]);
  const allowed = allowedTemperatures(bundle);
  const bad = new Set<number>();
  for (const s of found) {
    const v = Number(s);
    if (!Number.isFinite(v)) continue;
    const tol = s.includes('.') ? 0.051 : 0.5; // integers may be roundings of a bundle value
    if (!allowed.some((a) => Math.abs(a - v) <= tol)) bad.add(v);
  }
  return [...bad];
}

const OFFICIAL_CLAIMS = [
  /\b(red|orange|yellow)\s+(alert|warning)\b/i,
  /\bIMD\s+(has\s+)?(issued|declared|announced)\b/i,
  /\bofficial(ly)?\s+(declared|issued)\b/i,
];

/** Phrases implying an official warning exists when the bundle says none is available. */
export function unsupportedOfficialClaims(content: AdvisoryContent, bundle: ForecastBundle): string[] {
  if (bundle.officialWarnings.count > 0) return [];
  const text = [content.summary, content.forecastDetails, ...content.recommendedActions.map((a) => a.action)].join('\n');
  return OFFICIAL_CLAIMS.flatMap((re) => {
    const m = text.match(re);
    return m ? [m[0]] : [];
  });
}
