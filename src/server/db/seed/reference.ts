import { sql } from 'drizzle-orm';
import { PERMISSIONS, ROLES } from '@/lib/rbac';
import type { DB } from '../types';
import {
  appConfig,
  dataSources,
  modelVersions,
  permissions,
  rolePermissions,
  roles,
  severityThresholds,
} from '../schema';

export const SOURCE_KEYS = {
  openMeteoForecast: 'open-meteo-forecast',
  openMeteoArchive: 'open-meteo-archive',
  openMeteoPreviousRuns: 'open-meteo-previous-runs',
  imd: 'imd',
  baseline: 'climatiq-baseline',
  simulator: 'climatiq-simulator',
  iot: 'iot-gateway',
} as const;

export const DATA_SOURCES = [
  {
    key: SOURCE_KEYS.openMeteoForecast,
    name: 'Open-Meteo Forecast API',
    kind: 'external_api' as const,
    url: 'https://open-meteo.com/en/docs',
    license: 'CC BY 4.0 (data); free API for non-commercial use',
    attribution: 'Weather data by Open-Meteo.com',
    isConfigured: true,
    notes: 'Numerical weather prediction guidance (best-match models). Used as an input to the CLIMATIQ baseline, not as an official forecast.',
  },
  {
    key: SOURCE_KEYS.openMeteoArchive,
    name: 'Open-Meteo Historical Weather API (ERA5 reanalysis)',
    kind: 'external_api' as const,
    url: 'https://open-meteo.com/en/docs/historical-weather-api',
    license: 'CC BY 4.0 (data); ERA5 by Copernicus Climate Change Service',
    attribution: 'Weather data by Open-Meteo.com · Contains modified Copernicus Climate Change Service information',
    isConfigured: true,
    notes: 'Gridded reanalysis — a model-based reconstruction of past weather, not station observations. Lags real time by several days.',
  },
  {
    key: SOURCE_KEYS.openMeteoPreviousRuns,
    name: 'Open-Meteo Previous Runs API (archived NWP as issued)',
    kind: 'external_api' as const,
    url: 'https://open-meteo.com/en/docs/previous-runs-api',
    license: 'CC BY 4.0 (data)',
    attribution: 'Weather data by Open-Meteo.com',
    isConfigured: true,
    notes: 'Forecasts exactly as they were issued N days before the target day. Used so that the historical replay hindcast only uses information that was available at the time.',
  },
  {
    key: SOURCE_KEYS.imd,
    name: 'India Meteorological Department (IMD)',
    kind: 'official' as const,
    url: 'https://mausam.imd.gov.in/',
    license: 'Per IMD data policy',
    attribution: 'India Meteorological Department',
    isConfigured: false,
    notes: 'No openly permitted machine-readable API was available for this prototype. The adapter is implemented as "not configured"; official warnings are only shown when retrieved from a verifiable IMD source.',
  },
  {
    key: SOURCE_KEYS.baseline,
    name: 'CLIMATIQ baseline-v1 model',
    kind: 'model' as const,
    url: '/methodology',
    license: 'Project code',
    attribution: 'CLIMATIQ model output (decision support, not an official forecast)',
    isConfigured: true,
    notes: 'Statistical blend of NWP guidance, persistence and a 5-year reference climatology.',
  },
  {
    key: SOURCE_KEYS.simulator,
    name: 'CLIMATIQ demo simulator',
    kind: 'simulated' as const,
    url: '/methodology#simulated-data',
    license: 'Synthetic',
    attribution: 'Simulated demo data — not real measurements',
    isConfigured: true,
    notes: 'Deterministic synthetic data used for demo stations and as an offline fallback. Always labelled SIMULATED.',
  },
  {
    key: SOURCE_KEYS.iot,
    name: 'CLIMATIQ IoT ingestion gateway',
    kind: 'iot' as const,
    url: '/api/v1/stations/{code}/observations',
    license: 'Project code',
    attribution: 'Registered IoT weather stations',
    isConfigured: true,
    notes: 'HTTP/REST ingestion for future IoT stations. No physical hardware is deployed in this prototype.',
  },
];

/** CLIMATIQ severity scale derived from IMD heatwave criteria. Only rows that mirror IMD text are flagged official. */
const THRESHOLDS = (
  [
    ['plains', 40, true],
    ['coastal', 37, true],
    ['hilly', 30, true],
  ] as const
).flatMap(([zone, base]) => [
  {
    zone,
    level: 'extreme' as const,
    minTmaxC: base,
    minDepartureC: 6.5,
    absoluteTmaxC: zone === 'plains' ? 47 : null,
    basis: `IMD severe-heatwave criterion: Tmax ≥ ${base} °C and departure from normal ≥ 6.5 °C${zone === 'plains' ? ', or actual Tmax ≥ 47 °C' : ''}. Departures use CLIMATIQ's 5-year reference climatology, not IMD's official normals.`,
    isOfficialCriterion: true,
  },
  {
    zone,
    level: 'high' as const,
    minTmaxC: base,
    minDepartureC: 4.5,
    absoluteTmaxC: zone === 'plains' ? 45 : null,
    basis: `IMD heatwave criterion: Tmax ≥ ${base} °C and departure from normal 4.5–6.4 °C${zone === 'plains' ? ', or actual Tmax ≥ 45 °C' : ''}. Departures use CLIMATIQ's 5-year reference climatology.`,
    isOfficialCriterion: true,
  },
  {
    zone,
    level: 'moderate' as const,
    minTmaxC: base,
    minDepartureC: 2.5,
    absoluteTmaxC: null,
    basis: `CLIMATIQ-configured "approaching heatwave" class: Tmax ≥ ${base} °C and departure ≥ 2.5 °C. Not an IMD category.`,
    isOfficialCriterion: false,
  },
  {
    zone,
    level: 'low' as const,
    minTmaxC: null,
    minDepartureC: null,
    absoluteTmaxC: null,
    basis: 'Below all CLIMATIQ heat-risk thresholds. Not an IMD category.',
    isOfficialCriterion: false,
  },
]);

export const DEFAULT_CONFIG = [
  {
    key: 'alerts.min_severity',
    value: 'high',
    description: 'Lowest forecast severity that creates an automated CLIMATIQ alert.',
  },
  {
    key: 'alerts.min_confidence',
    value: 0.45,
    description: 'Minimum heuristic confidence score (0–1) required to raise an automated alert.',
  },
  {
    key: 'alerts.max_horizon_days',
    value: 5,
    description: 'Alerts are only raised for forecast days within this horizon.',
  },
  {
    key: 'alerts.cooldown_hours',
    value: 24,
    description: 'After an alert is resolved, the same region/day/severity is not re-alerted within this window.',
  },
  {
    key: 'retention.forecast_runs_days',
    value: 400,
    description: 'Forecast runs older than this are pruned (accuracy analysis needs history).',
  },
  {
    key: 'retention.notifications_days',
    value: 30,
    description: 'Read notifications older than this are deleted.',
  },
];

export async function seedReference(db: DB) {
  await db
    .insert(permissions)
    .values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })))
    .onConflictDoNothing();

  for (const [key, r] of Object.entries(ROLES)) {
    await db
      .insert(roles)
      .values({ key, name: r.name, description: r.description, rank: r.rank })
      .onConflictDoUpdate({ target: roles.key, set: { name: r.name, description: r.description, rank: r.rank } });
  }
  const roleRows = await db.select().from(roles);
  for (const row of roleRows) {
    const def = ROLES[row.key as keyof typeof ROLES];
    if (!def || def.permissions.length === 0) continue;
    await db
      .insert(rolePermissions)
      .values(def.permissions.map((p) => ({ roleId: row.id, permissionKey: p })))
      .onConflictDoNothing();
  }

  await db.insert(dataSources).values(DATA_SOURCES).onConflictDoNothing();

  await db
    .insert(modelVersions)
    .values({
      key: 'baseline-v1',
      name: 'CLIMATIQ Baseline v1',
      method: 'Weighted blend of NWP guidance (Open-Meteo), anomaly persistence and 5-year reference climatology',
      description:
        'Transparent statistical baseline. Uncertainty band is heuristic (nominal 80 %, not calibrated). Designed to be replaced or complemented by ML models through the model registry.',
    })
    .onConflictDoNothing();

  await db.insert(severityThresholds).values(THRESHOLDS).onConflictDoNothing();
  await db.insert(appConfig).values(DEFAULT_CONFIG).onConflictDoNothing();

  const roleCount = (await db.select({ n: sql<number>`count(*)::int` }).from(roles))[0]?.n ?? 0;
  return { roles: roleCount };
}
