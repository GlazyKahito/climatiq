import { eq } from 'drizzle-orm';
import type { DB } from '../types';
import { seedState } from '../schema';
import { seedReference } from './reference';
import { seedGeography } from './geography';
import { seedPeople } from './people';
import { seedHistory } from './history';
import { seedForecasts } from './forecasts';

export type SeedContext = { db: DB; log: (msg: string) => void };
export type SeedStep = { key: string; label: string; run: (ctx: SeedContext) => Promise<Record<string, unknown> | void> };

/**
 * Ordered, idempotent seed steps. Completed steps are recorded in `seed_state` and skipped on later runs, so
 * startup never overwrites existing operational data.
 *
 * Order: reference → geography → people → climate history → forecasts → stations → operations.
 * Feature modules register their steps by inserting an entry at the matching anchor comment below.
 */
export const SEED_STEPS: SeedStep[] = [
  { key: 'reference', label: 'roles, permissions, data sources, thresholds, config', run: ({ db }) => seedReference(db) },
  { key: 'geography', label: 'India, states/UTs, pilot districts and cities', run: ({ db }) => seedGeography(db) },
  { key: 'people', label: 'fictional demo users, roles and response teams', run: ({ db }) => seedPeople(db) },
  // [history-seed] climate history (ERA5 snapshot), reference normals, heat grid — registered by the lead
  { key: 'history', label: 'real ERA5 climate history snapshot, reference normals, replay heat grid', run: ({ db, log }) => seedHistory(db, log) },
  // [forecasts-seed] replay hindcast + live forecast runs, verifications — registered by the lead
  { key: 'forecasts', label: 'replay hindcast (2024-05-26) and live forecast runs', run: ({ db, log }) => seedForecasts(db, log) },
  // [stations-seed] simulated demo stations + observations — registered by the stations module
  { key: 'stations', label: 'SIMULATED demo weather stations + 7 days of hourly simulated observations', run: async ({ db }) => (await import('./stations')).seedStationsStep(db) },
  // [operations-seed] advisories, alerts, notifications, incidents, tasks — registered by the response module
  { key: 'operations', label: 'demo advisories (template), replay alerts + notifications, fictional incidents and tasks', run: async ({ db, log }) => (await import('./operations')).seedOperations(db, log) },
];

/** True when a seed step has completed (used by steps that depend on earlier ones). */
export async function stepDone(db: DB, key: string) {
  return (await db.select().from(seedState).where(eq(seedState.step, key)).limit(1)).length > 0;
}

export async function runSeed(db: DB, opts: { log?: (m: string) => void; steps?: SeedStep[] } = {}) {
  const log = opts.log ?? (() => {});
  const steps = opts.steps ?? SEED_STEPS;
  for (const step of steps) {
    const done = await db.select().from(seedState).where(eq(seedState.step, step.key)).limit(1);
    if (done.length) continue;
    log(`Seeding ${step.key} (${step.label}) …`);
    const started = Date.now();
    const detail = (await step.run({ db, log })) ?? {};
    if (detail.incomplete) {
      log(`  ${step.key} left pending: ${String(detail.reason ?? 'prerequisite missing')}`);
      continue;
    }
    await db.insert(seedState).values({ step: step.key, detail: { ...detail, ms: Date.now() - started } }).onConflictDoNothing();
  }
}
