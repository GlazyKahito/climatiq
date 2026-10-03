/**
 * Deterministic, always-available advisory writer. Produces audience-specific advisories purely from the forecast
 * bundle (every number is copied from it) plus widely accepted heat-health practice. Used when no AI provider is
 * configured and as the fallback whenever an AI provider fails, times out or returns unusable output.
 */
import type { AdvisoryContent } from '../../db/schema';
import { fmtDate, SEVERITY_META, type Severity } from '@/lib/domain';
import { withMandatoryLimitations } from '../guardrails';
import type { AudienceKey, BundleRegion, ForecastBundle } from '../schema';
import type { AdvisoryProvider } from './types';

export const TEMPLATE_VERSION = 'advisory-template-v1 (2026-10-03)';
export const TEMPLATE_MODEL = 'climatiq-template-v1';

export class TemplateProvider implements AdvisoryProvider {
  readonly name = 'template' as const;
  readonly modelName = TEMPLATE_MODEL;
  readonly promptVersion = TEMPLATE_VERSION;
  async generate(bundle: ForecastBundle): Promise<AdvisoryContent> {
    return templateAdvisory(bundle);
  }
}

type Priority = 'immediate' | 'soon' | 'routine';
const t = (c: number) => `${c.toFixed(1)} °C`;
const dep = (c: number) => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(1)} °C`;
const day = (d: string) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
const shortDay = (d: string) => fmtDate(d, { day: 'numeric', month: 'short' });
const rank = (s: Severity) => SEVERITY_META[s].rank;

function regionLabel(r: BundleRegion) {
  if (r.level === 'district') return `${r.name} district${r.parentName ? `, ${r.parentName}` : ''}`;
  if (r.level === 'state') return `${r.name} (state-level)`;
  return r.name;
}

function listNames(names: string[], max = 4) {
  if (names.length <= 1) return names[0] ?? '';
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

function window(b: ForecastBundle) {
  return b.window.from === b.window.to ? day(b.window.from) : `${shortDay(b.window.from)} – ${day(b.window.to)}`;
}

function hotRegions(b: ForecastBundle) {
  const hot = b.regions.filter((r) => rank(r.peak.severity) >= rank('high'));
  return (hot.length ? hot : b.regions).map((r) => r.name);
}

function imdNote(r: BundleRegion) {
  if (r.peak.imdCriteria === 'severe_heatwave') return ' — meets IMD severe-heatwave criteria as evaluated by CLIMATIQ (not an official declaration)';
  if (r.peak.imdCriteria === 'heatwave') return ' — meets IMD heatwave criteria as evaluated by CLIMATIQ (not an official declaration)';
  return '';
}

function spell(r: BundleRegion) {
  const n = r.peak.durationDays;
  if (n >= 2) return `${n}-day spell at High or above starting that day`;
  if (n === 1) return 'one day at High or above';
  return 'no day at High or above';
}

// ───────────────────────────── Summary ─────────────────────────────
function summary(b: ForecastBundle): string {
  const s = b.summary;
  const top = b.regions[0];
  const sev = SEVERITY_META[s.peakSeverity].label;
  const replay = b.run.scenario === 'replay';
  const names = listNames(b.regions.map((r) => r.name));
  const n = b.regions.length;

  if (b.audience === 'public') {
    const lead = replay ? 'Historical replay of the May 2024 heatwave (not a current forecast): ' : '';
    if (rank(s.peakSeverity) >= rank('high')) {
      return `${lead}Dangerously hot days are expected in ${names} between ${window(b)}. The hottest day is forecast around ${day(s.peakDate)} in ${top.name}, with a maximum of about ${t(s.peakTmaxC)} (${sev} heat risk). Heat at this level can make anyone ill — especially older people, young children, outdoor workers and people with health conditions. Stay cool, drink water and check on others.`;
    }
    if (s.peakSeverity === 'moderate') {
      return `${lead}Hotter than usual days are expected in ${names} between ${window(b)}, up to about ${t(s.peakTmaxC)} in ${top.name} around ${day(s.peakDate)} (Moderate heat risk). Take simple precautions, especially in the afternoon.`;
    }
    return `${lead}No dangerous heat is expected by CLIMATIQ in ${names} between ${window(b)}; the highest forecast maximum is about ${t(s.peakTmaxC)}. Normal hot-weather care is enough.`;
  }

  const lead = replay
    ? `Historical replay (CLIMATIQ hindcast issued as of ${day(b.run.issuedFor)}): `
    : `CLIMATIQ forecast issued for ${day(b.run.issuedFor)}: `;
  const core = `${sev} heat risk is forecast for ${names} between ${window(b)}, peaking at ${t(s.peakTmaxC)} in ${top.name} on ${day(s.peakDate)}${
    s.maxDepartureC != null && s.maxDepartureC > 0 ? ` (up to ${dep(s.maxDepartureC)} above the reference normal)` : ''
  }. ${s.regionsAtOrAboveHigh} of ${n} selected region${n === 1 ? '' : 's'} reach High or Extreme${s.maxDurationDays >= 2 ? `, with spells of up to ${s.maxDurationDays} days` : ''}.`;

  const ask: Record<AudienceKey, Record<'hot' | 'moderate' | 'low', string>> = {
    government: {
      hot: 'Review heat action plan triggers now and coordinate health, labour, water and power departments, after cross-checking the latest IMD bulletin.',
      moderate: 'Conditions approach heatwave thresholds; keep heat action plan measures on standby and monitor new runs.',
      low: 'No CLIMATIQ heat-risk thresholds are reached; routine seasonal monitoring is sufficient.',
    },
    disaster_mgmt: {
      hot: 'Bring EOC heat-response arrangements to readiness: supplies, ambulance and hospital capacity, vulnerable-group outreach and daily situation reporting.',
      moderate: 'Maintain preparedness and verify supplies so measures can be scaled up quickly if the next run escalates.',
      low: 'Routine preparedness only; re-check with the next forecast run.',
    },
    field_team: {
      hot: 'Protect your team first: avoid heavy work in the afternoon, hydrate on a schedule, work in pairs and know the signs of heat stroke.',
      moderate: 'Take heat precautions on outdoor duty, especially between noon and late afternoon.',
      low: 'Normal duties; keep hydrated and watch for updated forecasts.',
    },
    public: { hot: '', moderate: '', low: '' },
  };
  const key = rank(s.peakSeverity) >= rank('high') ? 'hot' : s.peakSeverity === 'moderate' ? 'moderate' : 'low';
  return `${lead}${core} ${ask[b.audience][key]}`;
}

// ───────────────────────────── Forecast details ─────────────────────────────
function forecastDetails(b: ForecastBundle): string {
  if (b.audience === 'public') {
    return b.regions
      .map((r) => {
        const hotter = r.peak.departureC != null && r.peak.departureC >= 1 ? `, about ${dep(r.peak.departureC).replace('+', '')} hotter than usual for the time of year` : '';
        const hotDays = r.days.filter((d) => rank(d.severity) >= rank('high')).map((d) => shortDay(d.targetDate));
        return `${r.name}: up to ${t(r.peak.predictedTmaxC)} on ${day(r.peak.targetDate)}${hotter} — ${SEVERITY_META[r.peak.severity].label} heat risk.${
          hotDays.length ? ` Hottest days: ${hotDays.join(', ')}.` : ''
        }`;
      })
      .join('\n');
  }
  return b.regions
    .map((r) => {
      const p = r.peak;
      const normal = p.normalTmaxC != null && p.departureC != null ? `, ${dep(p.departureC)} vs reference normal ${t(p.normalTmaxC)}` : '';
      const hot = r.days.filter((d) => rank(d.severity) >= rank('high'));
      const daysLine = hot.length
        ? ` Days at High or above: ${hot.map((d) => `${shortDay(d.targetDate)} ${t(d.predictedTmaxC)} (${SEVERITY_META[d.severity].label})`).join('; ')}.`
        : ` No day reaches High in the ${b.window.days}-day window.`;
      return `${regionLabel(r)}: peak ${t(p.predictedTmaxC)} on ${day(p.targetDate)} (band ${t(p.lowerC)}–${t(p.upperC)})${normal}; CLIMATIQ severity ${SEVERITY_META[p.severity].label}${imdNote(r)}; ${spell(r)}.${daysLine} Resolution: ${r.resolution}.`;
    })
    .join('\n');
}

// ───────────────────────────── Contributing factors ─────────────────────────────
function contributingFactors(b: ForecastBundle): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const top = b.regions[0];
  const rule = top.factors.find((f) => f.key === 'classification');
  if (rule && b.audience !== 'public') out.push(`Classification (${top.name}, ${shortDay(top.peak.targetDate)}): ${rule.detail}.`);
  for (const r of b.regions) {
    for (const f of r.factors) {
      if (f.key === 'classification' || f.impact !== 'raises' || seen.has(f.key)) continue;
      seen.add(f.key);
      out.push(b.audience === 'public' ? `${publicFactor(f.key, f.label)} (${f.value} in ${r.name}).` : `${f.label}: ${f.value} (${r.name}) — ${f.detail}`);
    }
  }
  const noNwp = b.regions.some((r) => r.factors.some((f) => f.key === 'nwp_missing'));
  if (noNwp && b.audience !== 'public') out.push('No numerical weather guidance in this run — the forecast leans on recent-heat persistence and reference climatology.');
  if (!out.length) out.push(b.audience === 'public' ? 'Temperatures are close to normal for the season.' : 'No strongly heat-raising factors were identified in the forecast inputs.');
  return out.slice(0, 6);
}

function publicFactor(key: string, label: string) {
  switch (key) {
    case 'departure':
      return 'Much hotter than normal for this time of year';
    case 'persistence':
      return 'The last few days have already been unusually hot';
    case 'warm_night':
      return 'Nights stay warm, so the body gets little relief';
    case 'dry_air':
      return 'Very dry air and strong sun';
    case 'humid_heat':
      return 'Humid heat feels hotter than the thermometer shows';
    case 'weak_wind':
      return 'Little wind to cool things down';
    case 'radiation':
      return 'Very strong sunshine';
    case 'nwp':
      return 'Weather models also expect very high temperatures';
    default:
      return label;
  }
}

// ───────────────────────────── Recommended actions ─────────────────────────────
type ActionDef = {
  text: (ctx: { win: string; places: string }) => string;
  audience?: string;
  /** Priority per severity [extreme, high, moderate, low]; null = not shown at that severity. */
  p: [Priority | null, Priority | null, Priority | null, Priority | null];
};
const pIndex: Record<Severity, number> = { extreme: 0, high: 1, moderate: 2, low: 3 };

const ACTIONS: Record<AudienceKey, ActionDef[]> = {
  government: [
    { text: () => 'Cross-check the latest IMD district bulletin and the state heat action plan triggers before issuing any official order; use this CLIMATIQ advisory as supporting analysis only.', audience: 'District / state administration', p: ['immediate', 'immediate', 'soon', 'routine'] },
    { text: ({ win }) => `Convene the heat action committee and confirm nodal officers for health, labour, water supply, power and education for ${win}.`, audience: 'District collectorate', p: ['immediate', 'immediate', null, null] },
    { text: () => 'Consider orders to reschedule outdoor labour (construction, MGNREGA and other worksites) away from roughly 12:00–16:00, with shade, drinking water and rest breaks at worksites.', audience: 'Labour department', p: ['immediate', 'immediate', 'soon', null] },
    { text: ({ places }) => `Direct health departments to confirm heat-illness readiness in ${places}: ORS and IV fluids, ice packs, cooled observation beds and ambulance availability.`, audience: 'Health department', p: ['immediate', 'immediate', 'soon', null] },
    { text: () => 'Ensure uninterrupted drinking-water supply and public water points at bus stands, markets and worksites; coordinate with power utilities to minimise outages during peak heat.', audience: 'Water supply & power utilities', p: ['immediate', 'soon', 'routine', null] },
    { text: () => 'Consider adjusting school timings and suspending outdoor school activities during the expected spell.', audience: 'Education department', p: ['soon', 'soon', null, null] },
    { text: () => 'Issue plain-language public heat-safety messages through local media, SMS and community networks, consistent with official IMD advisories and clearly attributed.', audience: 'Information & public relations', p: ['immediate', 'soon', 'routine', null] },
    { text: () => 'Track daily heat-illness reports and review this advisory when the next CLIMATIQ run or IMD bulletin is available.', p: ['soon', 'soon', 'routine', 'routine'] },
    { text: () => 'Continue routine seasonal monitoring; no CLIMATIQ heat-risk threshold is forecast to be reached.', p: [null, null, null, 'routine'] },
  ],
  disaster_mgmt: [
    { text: ({ win }) => `Activate or staff the EOC heat desk for ${win} and set a daily situation-report cycle.`, audience: 'State / district EOC', p: ['immediate', 'immediate', null, null] },
    { text: ({ places }) => `Pre-position ORS, drinking water, ice packs and first-aid kits with response teams in ${places}.`, audience: 'Logistics', p: ['immediate', 'immediate', 'soon', null] },
    { text: () => 'Confirm emergency ambulance readiness and hospital heatstroke-management capacity (rapid cooling, IV fluids), and share referral pathways with field teams.', audience: 'Health liaison', p: ['immediate', 'immediate', 'soon', null] },
    { text: () => 'Map and prioritise vulnerable groups for outreach — elderly people living alone, outdoor workers, homeless people, pregnant women, young children and people with chronic illness.', audience: 'Response teams', p: ['immediate', 'soon', 'soon', null] },
    { text: () => 'Open or identify cooling centres and shaded rest areas, and publicise their locations.', audience: 'Urban local bodies', p: ['immediate', 'soon', null, null] },
    { text: () => 'Heighten fire-safety readiness: extreme heat and dry conditions raise the risk of fires in markets, farms and dense settlements.', audience: 'Fire services', p: ['soon', 'soon', null, null] },
    { text: () => 'Set up heat-illness surveillance with daily line-listing of suspected heatstroke cases from hospitals, verified before reporting.', audience: 'Health surveillance', p: ['immediate', 'soon', 'routine', null] },
    { text: () => 'Re-check this advisory against each new CLIMATIQ run and the latest IMD bulletins, and escalate or stand down accordingly.', p: ['soon', 'soon', 'routine', 'routine'] },
    { text: () => 'Maintain routine preparedness; no CLIMATIQ heat-risk threshold is forecast to be reached.', p: [null, null, null, 'routine'] },
  ],
  field_team: [
    { text: () => 'Avoid strenuous outdoor work between about 12:00 and 16:00; schedule field visits for early morning or evening.', p: ['immediate', 'immediate', 'soon', null] },
    { text: () => 'Work in pairs and check each other for heat exhaustion: heavy sweating, dizziness, headache, nausea or cramps.', p: ['immediate', 'immediate', 'soon', null] },
    { text: () => 'Drink water every 15–20 minutes even if not thirsty; carry ORS sachets and know the refill points on your route.', p: ['immediate', 'immediate', 'soon', 'routine'] },
    { text: () => 'Heat stroke is an emergency (confusion, hot dry skin, collapse): move the person to shade, cool them with water and fanning, and call 112 or the nearest ambulance immediately.', p: ['immediate', 'immediate', 'soon', null] },
    { text: ({ places }) => `Prioritise visits in ${places} to vulnerable households — elderly people living alone, bedridden patients, families with infants — and check they have water and shade.`, p: ['immediate', 'soon', null, null] },
    { text: () => 'Wear light, loose, light-coloured cotton clothing and a head cover; rest in shade at regular intervals.', p: ['soon', 'soon', 'routine', 'routine'] },
    { text: () => 'Report suspected heat-illness cases and water-supply gaps to your control room the same day.', p: ['soon', 'soon', 'routine', null] },
    { text: () => 'Routine duties; stay hydrated and watch for updated CLIMATIQ forecasts.', p: [null, null, null, 'routine'] },
  ],
  public: [
    { text: () => 'Drink water often, even if you are not thirsty, and carry water when you go out.', audience: 'Everyone', p: ['immediate', 'immediate', 'soon', 'routine'] },
    { text: () => 'Stay indoors or in shade between 12 noon and 4 pm, when the heat is strongest.', audience: 'Everyone', p: ['immediate', 'immediate', 'soon', null] },
    { text: () => 'Wear light, loose cotton clothes and cover your head with a cap, cloth or umbrella.', audience: 'Everyone', p: ['immediate', 'soon', 'soon', 'routine'] },
    { text: () => 'If you work outdoors, take regular breaks in the shade and avoid heavy work in the afternoon.', audience: 'Outdoor workers', p: ['immediate', 'immediate', 'soon', null] },
    { text: () => 'Never leave children or pets inside a parked vehicle.', audience: 'Parents & carers', p: ['immediate', 'immediate', 'soon', null] },
    { text: () => 'Check on elderly neighbours, people living alone and anyone who is unwell.', audience: 'Neighbours & families', p: ['immediate', 'soon', 'soon', null] },
    { text: () => 'Drink ORS, buttermilk, lassi, lemon water or coconut water; avoid alcohol and very sugary or caffeinated drinks.', audience: 'Everyone', p: ['soon', 'soon', 'routine', null] },
    { text: () => 'If someone is confused, stops sweating, has hot dry skin or faints, move them to shade, cool them with water and call 112 immediately.', audience: 'Everyone', p: ['immediate', 'immediate', 'soon', null] },
    { text: () => 'Give animals shade and plenty of water.', audience: 'Pet and livestock owners', p: ['soon', 'soon', null, null] },
    { text: () => 'Follow official IMD and local government heat advisories; this CLIMATIQ advisory is for information only.', audience: 'Everyone', p: ['routine', 'routine', 'routine', 'routine'] },
    { text: () => 'No dangerous heat is expected by CLIMATIQ; normal hot-weather precautions are enough.', audience: 'Everyone', p: [null, null, null, 'routine'] },
  ],
};

const ORDER: Record<Priority, number> = { immediate: 0, soon: 1, routine: 2 };

function recommendedActions(b: ForecastBundle): AdvisoryContent['recommendedActions'] {
  const ctx = { win: window(b), places: listNames(hotRegions(b), 3) };
  const i = pIndex[b.summary.peakSeverity];
  return ACTIONS[b.audience]
    .map((a) => ({ a, p: a.p[i] }))
    .filter((x): x is { a: ActionDef; p: Priority } => x.p != null)
    .sort((x, y) => ORDER[x.p] - ORDER[y.p])
    .slice(0, 12)
    .map(({ a, p }) => ({ action: a.text(ctx), ...(a.audience ? { audience: a.audience } : {}), priority: p }));
}

// ───────────────────────────── Uncertainty ─────────────────────────────
function uncertainty(b: ForecastBundle): string {
  const top = b.regions[0];
  const p = top.peak;
  const noNwp = b.regions.some((r) => r.factors.some((f) => f.key === 'nwp_missing'));
  if (b.audience === 'public') {
    return `This is a computer forecast and can be off by a few degrees: around ${day(p.targetDate)} the maximum in ${top.name} could be anywhere between ${t(p.lowerC)} and ${t(p.upperC)}. CLIMATIQ rates its confidence as ${p.confidence}. Forecasts further ahead are less certain.`;
  }
  const scores = top.days.map((d) => `day ${d.horizonDay} ${d.confidenceScore.toFixed(2)}`).join(', ');
  return [
    `Confidence at the peak (${top.name}, ${day(p.targetDate)}): ${p.confidence} (heuristic score ${p.confidenceScore.toFixed(2)} — not a probability).`,
    `Uncertainty band at the peak: ${t(p.lowerC)}–${t(p.upperC)} (nominal 80 %, uncalibrated).`,
    `Confidence falls with lead time (${scores}).`,
    noNwp ? 'No numerical weather guidance was used in this run, so the forecast relies on persistence and climatology.' : '',
    `Values are at ${top.resolution} resolution; local urban heat may be higher.`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function templateAdvisory(bundle: ForecastBundle): AdvisoryContent {
  const content: AdvisoryContent = {
    summary: summary(bundle),
    forecastDetails: forecastDetails(bundle),
    contributingFactors: contributingFactors(bundle),
    recommendedActions: recommendedActions(bundle),
    uncertainty: uncertainty(bundle),
    limitations: [
      `Generated by the deterministic CLIMATIQ template (${TEMPLATE_VERSION}) from the forecast bundle — requires human review before approval.`,
    ],
  };
  return withMandatoryLimitations(content, bundle);
}
