/**
 * Zod schemas for AI-assisted advisories.
 *
 *  - `ForecastBundleSchema`  — the ONLY input any advisory provider receives. Built server-side from a stored forecast
 *                              run (see bundle.ts) and validated before it is sent anywhere.
 *  - `AdvisoryContentSchema` — the structured output every provider must return. Mirrors `AdvisoryContent` in the DB
 *                              schema exactly (compile-time checked below).
 */
import { z } from 'zod';
import type { AdvisoryContent } from '../db/schema';

export const SeveritySchema = z.enum(['low', 'moderate', 'high', 'extreme']);
export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const AudienceSchema = z.enum(['government', 'disaster_mgmt', 'field_team', 'public']);
export const ScenarioSchema = z.enum(['live', 'replay']);
export type AudienceKey = z.infer<typeof AudienceSchema>;

const DataKindSchema = z.enum(['observed', 'reanalysis', 'nwp_forecast', 'model_forecast', 'simulated']);

export const BundleDaySchema = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horizonDay: z.number().int().min(0).max(16),
  predictedTmaxC: z.number(),
  lowerC: z.number(),
  upperC: z.number(),
  predictedTminC: z.number().nullable(),
  normalTmaxC: z.number().nullable(),
  departureC: z.number().nullable(),
  severity: SeveritySchema,
  imdCriteria: z.enum(['none', 'heatwave', 'severe_heatwave']),
  confidence: ConfidenceSchema,
  confidenceScore: z.number().min(0).max(1),
  durationDays: z.number().int().min(0),
});
export type BundleDay = z.infer<typeof BundleDaySchema>;

export const BundleFactorSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  impact: z.string(),
  detail: z.string(),
});

export const BundleRegionSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(1),
  level: z.enum(['country', 'state', 'district', 'city']),
  parentName: z.string().nullable(),
  climateZone: z.enum(['plains', 'coastal', 'hilly']),
  resolution: z.string(),
  peak: BundleDaySchema,
  days: z.array(BundleDaySchema).min(1).max(16),
  factors: z.array(BundleFactorSchema).max(20),
  inputKinds: z.array(z.string()),
});
export type BundleRegion = z.infer<typeof BundleRegionSchema>;

export const BundleSourceSchema = z.object({
  key: z.string(),
  name: z.string(),
  sourceKind: z.string(),
  dataKind: DataKindSchema,
  url: z.string().nullable(),
  attribution: z.string().nullable(),
  role: z.string(),
});
export type BundleSource = z.infer<typeof BundleSourceSchema>;

export const ForecastBundleSchema = z.object({
  bundleVersion: z.literal('forecast-bundle-v1'),
  builtAt: z.string(),
  audience: AudienceSchema,
  run: z.object({
    id: z.string().uuid(),
    scenario: ScenarioSchema,
    scenarioLabel: z.string(),
    issuedFor: z.string(),
    horizonDays: z.number().int(),
    isHindcast: z.boolean(),
    modelKey: z.string(),
    modelName: z.string(),
    createdAt: z.string(),
    inputs: z.record(z.string(), z.string()),
  }),
  window: z.object({ from: z.string(), to: z.string(), days: z.number().int().min(1) }),
  summary: z.object({
    peakSeverity: SeveritySchema,
    peakRegionCode: z.string(),
    peakDate: z.string(),
    peakTmaxC: z.number(),
    maxDepartureC: z.number().nullable(),
    maxDurationDays: z.number().int().min(0),
    confidence: ConfidenceSchema,
    confidenceScore: z.number().min(0).max(1),
    regionsAtOrAboveHigh: z.number().int().min(0),
  }),
  regions: z.array(BundleRegionSchema).min(1).max(12),
  dataSources: z.array(BundleSourceSchema).min(1),
  officialWarnings: z.object({ count: z.number().int().min(0), note: z.string() }),
  notes: z.array(z.string()),
});
export type ForecastBundle = z.infer<typeof ForecastBundleSchema>;

export const PrioritySchema = z.enum(['immediate', 'soon', 'routine']);

export const AdvisoryContentSchema = z.object({
  summary: z.string().min(20).max(1500).describe('2–4 sentence overview for the intended audience.'),
  forecastDetails: z
    .string()
    .min(20)
    .max(6000)
    .describe('Region-by-region forecast details using ONLY numbers present in the forecast bundle.'),
  contributingFactors: z.array(z.string().min(3).max(400)).min(1).max(10).describe('Why the risk is elevated, from bundle factors.'),
  recommendedActions: z
    .array(
      z.object({
        action: z.string().min(5).max(500),
        audience: z.string().max(80).optional(),
        priority: PrioritySchema.optional(),
      }),
    )
    .min(2)
    .max(12),
  uncertainty: z.string().min(20).max(1200).describe('Confidence label/score (heuristic, not a probability), band and caveats.'),
  limitations: z.array(z.string().min(5).max(500)).min(1).max(10),
});

// Compile-time guarantee that the Zod schema and the stored `AdvisoryContent` type stay identical.
type Parsed = z.infer<typeof AdvisoryContentSchema>;
type Assert<T extends true> = T;
export type _SchemaMatchesStoredType = Assert<Parsed extends AdvisoryContent ? (AdvisoryContent extends Parsed ? true : false) : false>;

/** Server-attached source references (never produced by the model). */
export type SourceRef = { name: string; url?: string; kind: string; retrievedAt?: string };
