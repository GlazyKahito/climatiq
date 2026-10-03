/** Feature catalogue shared by the homepage showcase and the /features page (client-safe, no data values). */

export type FeatureId =
  | 'command-center'
  | 'heatwave-prediction'
  | 'weather-stations'
  | 'advisories-alerts'
  | 'response-crm'
  | 'climate-analytics'
  | 'public-portal'
  | 'methodology';

export type Feature = {
  id: FeatureId;
  title: string;
  short: string;
  href: string;
  icon: 'Radar' | 'ThermometerSun' | 'RadioTower' | 'Megaphone' | 'Siren' | 'ChartSpline' | 'Globe2' | 'BookOpenText';
  access: 'Public' | 'Signed-in' | 'Response roles' | 'Analysts & admins';
  kicker: string;
  summary: string;
  bullets: string[];
  /** what kind of data powers it, stated plainly */
  dataNote: string;
};

export const FEATURES: Feature[] = [
  {
    id: 'command-center',
    title: 'Climate command center',
    short: 'Command center',
    href: '/command',
    icon: 'Radar',
    access: 'Signed-in',
    kicker: 'Situational awareness',
    summary:
      'One console for the national picture: states and districts coloured by CLIMATIQ heat-risk level, drill-down from India to a district, metric cards and the newest alerts side by side.',
    bullets: [
      'India → state → district drill-down on an interactive map, with an accessible table alternative',
      'Layers for CLIMATIQ risk, forecast Tmax, the ERA5 heat grid and stations',
      'Switch between Live and the May 2024 historical replay at any time',
      'Every number carries a provenance badge: reanalysis, NWP guidance, CLIMATIQ forecast or simulated',
    ],
    dataNote: 'ERA5 reanalysis and Open-Meteo NWP guidance, processed by the CLIMATIQ baseline model.',
  },
  {
    id: 'heatwave-prediction',
    title: 'Heatwave prediction',
    short: 'Prediction',
    href: '/forecasts',
    icon: 'ThermometerSun',
    access: 'Signed-in',
    kicker: 'Seven-day outlook',
    summary:
      'District forecasts from a transparent statistical baseline: NWP guidance blended with anomaly persistence, compared with a five-year ERA5 reference climatology, with an uncertainty band you can see.',
    bullets: [
      'prediction(h) = w·NWP(h) + (1 − w)·persistence(h), with w falling from 0.85 to 0.55 over the horizon',
      'Nominal 80 % interval (uncalibrated) and a heuristic confidence label — never presented as a probability',
      'Severity mapped from IMD heatwave criteria to Low / Moderate / High / Extreme',
      'Contributing factors and expected spell duration explained for every district',
    ],
    dataNote: 'Model output (CLIMATIQ forecast). Hindcasts for the May 2024 replay use only NWP issued before each day.',
  },
  {
    id: 'weather-stations',
    title: 'Weather stations',
    short: 'Stations',
    href: '/stations',
    icon: 'RadioTower',
    access: 'Signed-in',
    kicker: 'Ground network',
    summary:
      'Station health, latest readings and plausibility checks. The demo stations are simulated and labelled everywhere; a real REST ingestion endpoint with per-station API keys is ready for IoT hardware.',
    bullets: [
      'Online / stale / offline status with last-seen times',
      'Plausibility checks and de-duplication on every reading',
      'Per-station hashed API keys for future IoT devices',
      'Simulated stations are flagged so they never pass as measurements',
    ],
    dataNote: 'Simulated demo stations (clearly marked). No real station hardware is connected yet.',
  },
  {
    id: 'advisories-alerts',
    title: 'AI advisories & alerts',
    short: 'Advisories',
    href: '/advisories',
    icon: 'Megaphone',
    access: 'Signed-in',
    kicker: 'Human-in-the-loop AI',
    summary:
      'Audience-specific advisories drafted by AI from a validated forecast bundle — for administrators, disaster-management teams, field responders and the public — and published only after an authorised person approves them.',
    bullets: [
      'Structured output validated against a schema; the model may not invent observations or official warnings',
      'Deterministic template fallback, so advisories still work when the AI provider is unavailable',
      'Rule engine raises alerts with de-duplication and cooldowns',
      'In-app notifications routed by role and region',
    ],
    dataNote: 'CLIMATIQ-generated text — always labelled as not official.',
  },
  {
    id: 'response-crm',
    title: 'Response CRM',
    short: 'Response',
    href: '/response',
    icon: 'Siren',
    access: 'Response roles',
    kicker: 'From signal to action',
    summary:
      'Incidents move from reported to closed with priorities, owners, teams, due dates and tasks, and every step lands on an auditable activity timeline.',
    bullets: [
      'Workflow: reported → triaged → in progress → monitoring → resolved → closed',
      'P1–P4 priorities, team workload and overdue tracking',
      'Link incidents to the alert or advisory that triggered them',
      'Region-scoped access: teams see what they are responsible for',
    ],
    dataNote: 'Demo incidents, teams and people are fictional.',
  },
  {
    id: 'climate-analytics',
    title: 'Climate analytics',
    short: 'Analytics',
    href: '/analytics',
    icon: 'ChartSpline',
    access: 'Analysts & admins',
    kicker: 'Trust, measured',
    summary:
      'Explore history, compare regions and verify forecasts against what happened — with MAE, RMSE, bias and severity hit/miss rates, flagged when samples are small or the “truth” is reanalysis.',
    bullets: [
      'Daily history and anomalies by region',
      'Forecast verification and accuracy over time',
      'Region and period comparisons',
      'CSV export for your own analysis',
    ],
    dataNote: 'ERA5 reanalysis as reference truth — not station observations.',
  },
  {
    id: 'public-portal',
    title: 'Public climate portal',
    short: 'Public portal',
    href: '/portal',
    icon: 'Globe2',
    access: 'Public',
    kicker: 'For everyone',
    summary:
      'Plain-language heat-risk information by region and the public advisories that officials have approved — no account needed, readable on any phone.',
    bullets: [
      'Only published public advisories appear',
      'Region pages with the outlook and simple precautions',
      'Clear links to official IMD warnings',
      'Fast, accessible and mobile-first',
    ],
    dataNote: 'Shows CLIMATIQ output with its provenance and a pointer to official sources.',
  },
  {
    id: 'methodology',
    title: 'Methodology & transparency',
    short: 'Methodology',
    href: '/methodology',
    icon: 'BookOpenText',
    access: 'Public',
    kicker: 'Show your working',
    summary:
      'Data sources, model equations, severity thresholds, known limitations and licences — everything a reviewer needs to judge how far to trust a number.',
    bullets: [
      'Every data kind explained: observed, reanalysis, NWP guidance, CLIMATIQ forecast, simulated',
      'Severity rules and how they relate to IMD criteria',
      'Known limitations of a five-year reference climatology',
      'Attribution for Open-Meteo, ERA5, geoBoundaries, GeoNames and Natural Earth',
    ],
    dataNote: 'Documentation.',
  },
];
