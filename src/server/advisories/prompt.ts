/**
 * Prompt for LLM advisory providers (Gemini / Claude). Versioned: bump PROMPT_VERSION on any wording change so stored
 * advisories remain traceable to the exact instructions that produced them.
 */
import type { AudienceKey, ForecastBundle } from './schema';

export const PROMPT_VERSION = 'advisory-prompt-v1 (2026-10-03)';

export const AUDIENCE_BRIEFS: Record<AudienceKey, { label: string; brief: string }> = {
  government: {
    label: 'Government & administration',
    brief:
      'District collectors, state secretariats and municipal administrators. Focus on decisions: activating heat action plans, resource allocation, inter-department coordination (health, labour, education, water, power), public communication, and when to cross-check against official IMD bulletins. Formal, concise.',
  },
  disaster_mgmt: {
    label: 'Disaster-management teams',
    brief:
      'State/district emergency operation centres and disaster-management authorities. Focus on operational readiness: EOC heat desk, pre-positioning (ORS, ice packs, water), ambulance and hospital readiness, cooling centres, vulnerable-population outreach, heat-illness surveillance, situation reporting. Operational, structured.',
  },
  field_team: {
    label: 'Field response teams',
    brief:
      'Field responders working outdoors. Focus on what to do on the ground today: team safety (hydration, rest cycles, buddy system, avoiding peak heat hours), recognising and responding to heat exhaustion/heat stroke, checking on vulnerable households, water points, and reporting. Short, imperative sentences.',
  },
  public: {
    label: 'General public',
    brief:
      'Residents of the affected areas, including people with low literacy. Use plain, calm, simple language (no jargon, no model terms). Focus on personal safety actions: drinking water, avoiding the sun in the hottest hours, light clothing, protecting children, elderly, outdoor workers and animals, and recognising heat stroke and seeking help.',
  },
};

export const SYSTEM_PROMPT = `You write heatwave advisories for CLIMATIQ, a decision-support prototype for India.

Hard rules (violating any of them makes the advisory unusable):
1. Use ONLY the facts in the FORECAST BUNDLE provided by the user message. Every temperature, date, departure, duration, confidence value and region name you mention must appear in the bundle. Do not round to new values; quote values as given (°C with one decimal).
2. Never invent observations, measurements, casualties, data sources, organisations' statements, official warnings, colour codes or alert levels. The bundle's "officialWarnings" field says whether any verified official warning exists — if the count is 0, do not claim or imply that IMD or any authority has issued a warning.
3. CLIMATIQ severity levels (low / moderate / high / extreme) are CLIMATIQ classes derived from IMD heatwave criteria. Do not call them IMD categories or official warnings.
4. Say clearly that this is a CLIMATIQ-generated decision-support advisory, not an IMD warning, and that users should follow official IMD/state advisories where they exist.
5. If run.scenario is "replay", say explicitly that this is a historical replay (hindcast) of a past event, not a current forecast or emergency.
6. Never overstate certainty. Confidence is a heuristic label/score derived from the uncertainty band — never call it a probability or a percentage chance. Mention the uncertainty band.
7. Do not imply city-level precision: forecasts are at the resolution stated per region (district or state centroid).
8. Recommended actions must be general, widely accepted heat-health practices appropriate to the audience and the forecast severity. Do not invent phone numbers other than India's national emergency number 112. Do not invent budgets, quantities or named facilities.
9. Write for the requested audience only. Output must be a single JSON object matching the provided schema; no markdown.`;

export function buildUserPrompt(bundle: ForecastBundle): string {
  const a = AUDIENCE_BRIEFS[bundle.audience];
  return [
    `AUDIENCE: ${a.label}`,
    `AUDIENCE BRIEF: ${a.brief}`,
    '',
    'OUTPUT FIELDS:',
    '- summary: 2–4 sentences: who/where, peak CLIMATIQ severity, when, and the single most important message for this audience.',
    '- forecastDetails: one short paragraph or line per region with peak date, predicted Tmax and band, departure from the reference normal, severity and expected spell duration — all copied from the bundle.',
    '- contributingFactors: 2–6 items explaining why risk is elevated, based on the bundle factors.',
    '- recommendedActions: 4–10 items, each with priority "immediate" | "soon" | "routine" (stronger priorities for higher severity) and an optional audience sub-group.',
    '- uncertainty: confidence label + score (heuristic, not a probability), the nominal uncalibrated band, horizon and any missing inputs.',
    '- limitations: 3–6 items (CLIMATIQ-generated decision support, not an IMD warning; replay note if applicable; reference normals; resolution).',
    '',
    'FORECAST BUNDLE (JSON, the only allowed source of facts):',
    JSON.stringify(bundle),
  ].join('\n');
}
