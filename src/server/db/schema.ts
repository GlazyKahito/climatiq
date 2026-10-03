/**
 * CLIMATIQ PostgreSQL schema (Drizzle ORM).
 * Generated SQL migrations live in /drizzle — run `npm run db:generate` after editing this file.
 *
 * Conventions
 *  - Every climate value carries `data_kind` (provenance) and a `source_id`.
 *  - Demo/fictional records carry `is_demo = true` so the safe demo reset can target them precisely.
 *  - Timestamps are `timestamptz`; calendar days for daily climate are `date` (IST calendar).
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ───────────────────────────── Enums ─────────────────────────────
export const regionLevel = pgEnum('region_level', ['country', 'state', 'district', 'city']);
export const climateZone = pgEnum('climate_zone', ['plains', 'coastal', 'hilly']);
export const dataKind = pgEnum('data_kind', [
  'observed', // in-situ measurement from a verified source
  'reanalysis', // e.g. ERA5 via Open-Meteo archive
  'nwp_forecast', // third-party numerical weather prediction guidance
  'model_forecast', // CLIMATIQ model output
  'simulated', // demo / synthetic data — always labelled
]);
export const sourceKind = pgEnum('source_kind', ['official', 'external_api', 'iot', 'model', 'simulated']);
export const severity = pgEnum('severity', ['low', 'moderate', 'high', 'extreme']);
export const confidenceLabel = pgEnum('confidence_label', ['low', 'medium', 'high']);
export const stationStatus = pgEnum('station_status', ['online', 'degraded', 'offline', 'planned']);
export const stationType = pgEnum('station_type', ['aws_simulated', 'iot', 'external']);
export const obsQuality = pgEnum('obs_quality', ['verified', 'unverified', 'suspect', 'rejected']);
export const runStatus = pgEnum('run_status', ['running', 'succeeded', 'partial', 'failed']);
export const advisoryStatus = pgEnum('advisory_status', ['draft', 'approved', 'published', 'archived']);
export const audience = pgEnum('audience', ['government', 'disaster_mgmt', 'field_team', 'public']);
export const alertStatus = pgEnum('alert_status', ['active', 'acknowledged', 'resolved', 'expired']);
export const incidentStatus = pgEnum('incident_status', [
  'reported',
  'triaged',
  'in_progress',
  'monitoring',
  'resolved',
  'closed',
]);
export const priority = pgEnum('priority', ['p1', 'p2', 'p3', 'p4']);
export const taskStatus = pgEnum('task_status', ['todo', 'in_progress', 'blocked', 'done']);
export const teamKind = pgEnum('team_kind', ['state_eoc', 'district_response', 'field_unit', 'health', 'analysis']);
export const scenario = pgEnum('scenario', ['live', 'replay']);

// ───────────────────────────── Identity & access ─────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    designation: text('designation'),
    passwordHash: text('password_hash').notNull(),
    isDemo: boolean('is_demo').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    themePref: text('theme_pref').notNull().default('system'),
    createdAt: createdAt(),
    lastLoginAt: ts('last_login_at'),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    check('users_theme_ck', sql`${t.themePref} in ('light','dark','system')`),
  ],
);

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  rank: integer('rank').notNull(), // display order / seniority
});

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(), // e.g. 'incident:update'
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

// ───────────────────────────── Geography ─────────────────────────────
export const regions = pgTable(
  'regions',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(), // e.g. IN, IN-RJ, IN-RJ-JAIPUR, IN-RJ-JAIPUR-C-JAIPUR
    name: text('name').notNull(),
    level: regionLevel('level').notNull(),
    parentId: integer('parent_id').references((): AnyPgColumn => regions.id, { onDelete: 'restrict' }),
    path: text('path').notNull(), // materialised path of codes: 'IN/IN-RJ/IN-RJ-JAIPUR'
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    climateZone: climateZone('climate_zone').notNull().default('plains'),
    isPilot: boolean('is_pilot').notNull().default(false),
    population: integer('population'),
    geoSource: text('geo_source').notNull(), // provenance of name / boundary / coordinates
  },
  (t) => [
    index('regions_parent_idx').on(t.parentId),
    index('regions_level_idx').on(t.level),
    index('regions_path_idx').on(t.path),
    check('regions_lat_ck', sql`${t.lat} between -90 and 90`),
    check('regions_lon_ck', sql`${t.lon} between -180 and 180`),
    check('regions_parent_ck', sql`(${t.level} = 'country') = (${t.parentId} is null)`),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    regionId: integer('region_id').references(() => regions.id, { onDelete: 'cascade' }), // null = nationwide
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('user_roles_uq').on(t.userId, t.roleId, sql`coalesce(${t.regionId}, 0)`),
    index('user_roles_user_idx').on(t.userId),
  ],
);

// ───────────────────────────── Sources & ingestion ─────────────────────────────
export const dataSources = pgTable('data_sources', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(), // 'open-meteo-forecast', 'open-meteo-archive', 'imd', 'climatiq-sim', ...
  name: text('name').notNull(),
  kind: sourceKind('kind').notNull(),
  url: text('url'),
  license: text('license'),
  attribution: text('attribution'),
  isConfigured: boolean('is_configured').notNull().default(true),
  notes: text('notes'),
});

export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id),
    job: text('job').notNull(), // 'forecast', 'archive', 'station', 'iot'
    status: runStatus('status').notNull().default('running'),
    triggeredBy: text('triggered_by').notNull(), // 'seed' | 'cron' | 'admin:<userId>' | 'iot:<station>'
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    recordsIn: integer('records_in').notNull().default(0),
    recordsWritten: integer('records_written').notNull().default(0),
    attempts: integer('attempts').notNull().default(1),
    error: text('error'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('ingestion_runs_source_idx').on(t.sourceId, t.startedAt)],
);

// ───────────────────────────── Stations & observations ─────────────────────────────
export const weatherStations = pgTable(
  'weather_stations',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    elevationM: integer('elevation_m'),
    stationType: stationType('station_type').notNull(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id),
    status: stationStatus('status').notNull().default('planned'),
    isSimulated: boolean('is_simulated').notNull(),
    sensors: jsonb('sensors').$type<string[]>().notNull().default([]),
    apiKeyHash: text('api_key_hash'), // IoT stations only (sha-256 of the key)
    registeredAt: createdAt(),
    lastSeenAt: ts('last_seen_at'),
    isDemo: boolean('is_demo').notNull().default(false),
  },
  (t) => [
    index('stations_region_idx').on(t.regionId),
    check('stations_sim_ck', sql`(${t.stationType} = 'aws_simulated') = ${t.isSimulated}`),
  ],
);

export const stationObservations = pgTable(
  'station_observations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    stationId: integer('station_id')
      .notNull()
      .references(() => weatherStations.id, { onDelete: 'cascade' }),
    observedAt: ts('observed_at').notNull(),
    tempC: doublePrecision('temp_c'),
    humidityPct: doublePrecision('humidity_pct'),
    windKmh: doublePrecision('wind_kmh'),
    pressureHpa: doublePrecision('pressure_hpa'),
    dataKind: dataKind('data_kind').notNull(),
    quality: obsQuality('quality').notNull().default('unverified'),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id, { onDelete: 'set null' }),
    receivedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('station_obs_uq').on(t.stationId, t.observedAt),
    check('station_obs_temp_ck', sql`${t.tempC} is null or ${t.tempC} between -60 and 65`),
    check('station_obs_rh_ck', sql`${t.humidityPct} is null or ${t.humidityPct} between 0 and 100`),
  ],
);

/** Region-level daily climate (observed / reanalysis / simulated). One row per region × source × day × kind. */
export const dailyClimate = pgTable(
  'daily_climate',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id),
    day: date('day', { mode: 'string' }).notNull(),
    dataKind: dataKind('data_kind').notNull(),
    tmaxC: doublePrecision('tmax_c'),
    tminC: doublePrecision('tmin_c'),
    apparentTmaxC: doublePrecision('apparent_tmax_c'),
    rhMeanPct: doublePrecision('rh_mean_pct'),
    windMaxKmh: doublePrecision('wind_max_kmh'),
    radiationMj: doublePrecision('radiation_mj'),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id, { onDelete: 'set null' }),
    updatedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('daily_climate_uq').on(t.regionId, t.sourceId, t.day, t.dataKind),
    index('daily_climate_region_day_idx').on(t.regionId, t.day),
    check('daily_climate_kind_ck', sql`${t.dataKind} <> 'model_forecast'`),
  ],
);

/** Regular lat/lon grid (heat-map layer). Values are real (reanalysis / NWP) or simulated, never model output. */
export const gridDaily = pgTable(
  'grid_daily',
  {
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    dataKind: dataKind('data_kind').notNull(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id),
    tmaxC: doublePrecision('tmax_c').notNull(),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.lat, t.lon, t.day, t.dataKind] }), index('grid_daily_day_idx').on(t.day, t.dataKind)],
);

/** Reference climatology by day-of-year (few-year ERA5 mean). NOT an official 30-year IMD/WMO normal. */
export const climateNormals = pgTable(
  'climate_normals',
  {
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
    basisKey: text('basis_key').notNull(), // e.g. 'era5-spring-2019-2023', 'era5-2021-2025'
    dayOfYear: integer('day_of_year').notNull(),
    normalTmaxC: doublePrecision('normal_tmax_c').notNull(),
    normalTminC: doublePrecision('normal_tmin_c'),
    basis: text('basis').notNull(), // e.g. 'ERA5 2020-2024 mean, ±7 day window'
    sampleYears: integer('sample_years').notNull(),
    dataKind: dataKind('data_kind').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.regionId, t.basisKey, t.dayOfYear] }),
    check('normals_doy_ck', sql`${t.dayOfYear} between 1 and 366`),
  ],
);

// ───────────────────────────── Forecasting ─────────────────────────────
export const modelVersions = pgTable('model_versions', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(), // 'baseline-v1'
  name: text('name').notNull(),
  method: text('method').notNull(),
  description: text('description').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const forecastRuns = pgTable(
  'forecast_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelVersionId: integer('model_version_id')
      .notNull()
      .references(() => modelVersions.id),
    scenario: scenario('scenario').notNull().default('live'),
    issuedFor: date('issued_for', { mode: 'string' }).notNull(), // the "as of" date (day 0)
    horizonDays: integer('horizon_days').notNull(),
    status: runStatus('status').notNull().default('running'),
    isHindcast: boolean('is_hindcast').notNull().default(false),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    regionsCount: integer('regions_count').notNull().default(0),
    error: text('error'),
    triggeredBy: text('triggered_by').notNull(),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('forecast_runs_issued_idx').on(t.scenario, t.issuedFor),
    check('forecast_runs_horizon_ck', sql`${t.horizonDays} between 1 and 16`),
  ],
);

export type ForecastFactor = {
  key: string;
  label: string;
  value: string;
  impact: 'raises' | 'lowers' | 'neutral';
  detail: string;
};

export const forecasts = pgTable(
  'forecasts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => forecastRuns.id, { onDelete: 'cascade' }),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
    targetDate: date('target_date', { mode: 'string' }).notNull(),
    horizonDay: integer('horizon_day').notNull(),
    resolution: text('resolution').notNull(), // 'district-centroid' | 'state-centroid' | 'point'
    predictedTmaxC: doublePrecision('predicted_tmax_c').notNull(),
    lowerC: doublePrecision('lower_c').notNull(),
    upperC: doublePrecision('upper_c').notNull(),
    predictedTminC: doublePrecision('predicted_tmin_c'),
    nwpTmaxC: doublePrecision('nwp_tmax_c'),
    normalTmaxC: doublePrecision('normal_tmax_c'),
    departureC: doublePrecision('departure_c'),
    severity: severity('severity').notNull(),
    imdCategory: text('imd_category').notNull(), // 'none' | 'heatwave' | 'severe_heatwave' (criteria-based, not official)
    confidence: confidenceLabel('confidence').notNull(),
    confidenceScore: doublePrecision('confidence_score').notNull(), // heuristic 0..1, NOT a calibrated probability
    durationDays: integer('duration_days').notNull().default(0),
    factors: jsonb('factors').$type<ForecastFactor[]>().notNull().default([]),
    inputKinds: jsonb('input_kinds').$type<string[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex('forecasts_uq').on(t.runId, t.regionId, t.targetDate),
    index('forecasts_region_date_idx').on(t.regionId, t.targetDate),
    index('forecasts_severity_idx').on(t.runId, t.severity),
    check('forecasts_interval_ck', sql`${t.lowerC} <= ${t.predictedTmaxC} and ${t.predictedTmaxC} <= ${t.upperC}`),
    check('forecasts_conf_ck', sql`${t.confidenceScore} between 0 and 1`),
    check('forecasts_imd_ck', sql`${t.imdCategory} in ('none','heatwave','severe_heatwave')`),
  ],
);

export const forecastVerifications = pgTable(
  'forecast_verifications',
  {
    forecastId: bigint('forecast_id', { mode: 'number' })
      .primaryKey()
      .references(() => forecasts.id, { onDelete: 'cascade' }),
    observedTmaxC: doublePrecision('observed_tmax_c').notNull(),
    observedKind: dataKind('observed_kind').notNull(),
    errorC: doublePrecision('error_c').notNull(), // predicted − observed
    observedSeverity: severity('observed_severity').notNull(),
    evaluatedAt: createdAt(),
  },
);

/** Configurable severity thresholds per climate zone (CLIMATIQ classes derived from IMD heatwave criteria). */
export const severityThresholds = pgTable(
  'severity_thresholds',
  {
    id: serial('id').primaryKey(),
    zone: climateZone('zone').notNull(),
    level: severity('level').notNull(),
    minTmaxC: doublePrecision('min_tmax_c'), // zone base threshold (e.g. 40 plains)
    minDepartureC: doublePrecision('min_departure_c'),
    absoluteTmaxC: doublePrecision('absolute_tmax_c'), // e.g. 45/47 °C plains absolute criteria
    basis: text('basis').notNull(),
    isOfficialCriterion: boolean('is_official_criterion').notNull(), // true only where the rule mirrors IMD text
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex('severity_thresholds_uq').on(t.zone, t.level)],
);

export const officialWarnings = pgTable(
  'official_warnings',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => dataSources.id),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id),
    colorCode: text('color_code').notNull(), // IMD colour: green | yellow | orange | red
    title: text('title').notNull(),
    issuedAt: ts('issued_at').notNull(),
    validFrom: ts('valid_from').notNull(),
    validTo: ts('valid_to').notNull(),
    url: text('url').notNull(),
    retrievedAt: ts('retrieved_at').notNull(),
    verified: boolean('verified').notNull().default(false),
  },
  (t) => [check('official_color_ck', sql`${t.colorCode} in ('green','yellow','orange','red')`)],
);

// ───────────────────────────── Advisories, alerts, notifications ─────────────────────────────
export type AdvisoryContent = {
  summary: string;
  forecastDetails: string;
  contributingFactors: string[];
  recommendedActions: { action: string; audience?: string; priority?: 'immediate' | 'soon' | 'routine' }[];
  uncertainty: string;
  limitations: string[];
};

export const advisories = pgTable(
  'advisories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    severity: severity('severity').notNull(),
    audience: audience('audience').notNull(),
    status: advisoryStatus('status').notNull().default('draft'),
    forecastRunId: uuid('forecast_run_id').references(() => forecastRuns.id, { onDelete: 'set null' }),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }).notNull(),
    expectedDurationDays: integer('expected_duration_days').notNull().default(0),
    confidence: confidenceLabel('confidence').notNull(),
    content: jsonb('content').$type<AdvisoryContent>().notNull(),
    sourceRefs: jsonb('source_refs')
      .$type<{ name: string; url?: string; kind: string; retrievedAt?: string }[]>()
      .notNull()
      .default([]),
    provider: text('provider').notNull(), // 'gemini' | 'anthropic' | 'template'
    modelName: text('model_name').notNull(),
    promptVersion: text('prompt_version').notNull(),
    fallbackReason: text('fallback_reason'),
    generatedAt: ts('generated_at').notNull().defaultNow(),
    generatedBy: uuid('generated_by').references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: ts('approved_at'),
    publishedAt: ts('published_at'),
    isDemo: boolean('is_demo').notNull().default(false),
  },
  (t) => [
    index('advisories_status_idx').on(t.status, t.generatedAt),
    check('advisories_valid_ck', sql`${t.validFrom} <= ${t.validTo}`),
  ],
);

export const advisoryRegions = pgTable(
  'advisory_regions',
  {
    advisoryId: uuid('advisory_id')
      .notNull()
      .references(() => advisories.id, { onDelete: 'cascade' }),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.advisoryId, t.regionId] }), index('advisory_regions_region_idx').on(t.regionId)],
);

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
    forecastId: bigint('forecast_id', { mode: 'number' }).references(() => forecasts.id, { onDelete: 'set null' }),
    advisoryId: uuid('advisory_id').references(() => advisories.id, { onDelete: 'set null' }),
    severity: severity('severity').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    targetDate: date('target_date', { mode: 'string' }).notNull(),
    status: alertStatus('status').notNull().default('active'),
    dedupKey: text('dedup_key').notNull(),
    rule: jsonb('rule').$type<Record<string, unknown>>().notNull().default({}),
    confidenceScore: doublePrecision('confidence_score').notNull(),
    createdAt: createdAt(),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    acknowledgedAt: ts('acknowledged_at'),
    resolvedAt: ts('resolved_at'),
    isDemo: boolean('is_demo').notNull().default(false),
  },
  (t) => [
    // At most one open (active/acknowledged) alert per dedup key.
    uniqueIndex('alerts_dedup_open_uq')
      .on(t.dedupKey)
      .where(sql`${t.status} in ('active','acknowledged')`),
    index('alerts_region_idx').on(t.regionId, t.createdAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull().default('in_app'),
    kind: text('kind').notNull(), // 'alert' | 'advisory' | 'incident' | 'system'
    severity: severity('severity'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    regionId: integer('region_id').references(() => regions.id, { onDelete: 'set null' }),
    alertId: uuid('alert_id').references(() => alerts.id, { onDelete: 'cascade' }),
    advisoryId: uuid('advisory_id').references(() => advisories.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
    isDemo: boolean('is_demo').notNull().default(false),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('notifications_alert_user_uq')
      .on(t.userId, t.alertId)
      .where(sql`${t.alertId} is not null`),
  ],
);

// ───────────────────────────── Response CRM ─────────────────────────────
export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  kind: teamKind('kind').notNull(),
  regionId: integer('region_id')
    .notNull()
    .references(() => regions.id),
  isDemo: boolean('is_demo').notNull().default(false),
});

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isLead: boolean('is_lead').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ref: text('ref').notNull().unique(), // INC-2026-0001
    title: text('title').notNull(),
    description: text('description').notNull(),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id),
    severity: severity('severity').notNull(),
    priority: priority('priority').notNull(),
    status: incidentStatus('status').notNull().default('reported'),
    alertId: uuid('alert_id').references(() => alerts.id, { onDelete: 'set null' }),
    advisoryId: uuid('advisory_id').references(() => advisories.id, { onDelete: 'set null' }),
    teamId: integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: ts('due_at'),
    openedBy: uuid('opened_by').references(() => users.id, { onDelete: 'set null' }),
    openedAt: ts('opened_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
    closedAt: ts('closed_at'),
    resolutionSummary: text('resolution_summary'),
    isDemo: boolean('is_demo').notNull().default(false),
  },
  (t) => [
    index('incidents_status_idx').on(t.status, t.priority),
    index('incidents_region_idx').on(t.regionId),
    check(
      'incidents_closed_ck',
      sql`(${t.status} not in ('resolved','closed')) or ${t.resolutionSummary} is not null`,
    ),
  ],
);

export const incidentTasks = pgTable(
  'incident_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: taskStatus('status').notNull().default('todo'),
    priority: priority('priority').notNull().default('p3'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: ts('due_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('incident_tasks_incident_idx').on(t.incidentId), index('incident_tasks_assignee_idx').on(t.assigneeId)],
);

export const incidentActivities = pgTable(
  'incident_activities',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(), // created | status_change | note | assignment | task | link
    body: text('body').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('incident_activities_incident_idx').on(t.incidentId, t.createdAt)],
);

// ───────────────────────────── Audit, corrections, config ─────────────────────────────
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorLabel: text('actor_label').notNull(), // preserved even if the user is deleted
    action: text('action').notNull(), // e.g. 'incident.status_change'
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    regionId: integer('region_id').references(() => regions.id, { onDelete: 'set null' }),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt), index('audit_logs_entity_idx').on(t.entityType, t.entityId)],
);

export const dataCorrections = pgTable('data_corrections', {
  id: serial('id').primaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  reason: text('reason').notNull(),
  correctedBy: uuid('corrected_by').references(() => users.id, { onDelete: 'set null' }),
  correctedAt: createdAt(),
});

export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description').notNull(),
  updatedAt: createdAt(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/** Marks completed seed steps so demo initialisation is idempotent. */
export const seedState = pgTable('seed_state', {
  step: text('step').primaryKey(),
  completedAt: createdAt(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
});
