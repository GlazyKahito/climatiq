import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { advisories, alerts, dataSources, forecastRuns, ingestionRuns, modelVersions, notifications } from '../db/schema';

export type SourceStatus = {
  key: string;
  name: string;
  kind: string;
  isConfigured: boolean;
  lastSuccess: string | null;
  lastFailure: string | null;
  lastError: string | null;
  lastStatus: string | null;
};

export async function sourceStatuses(db: DB): Promise<SourceStatus[]> {
  const sources = await db.select().from(dataSources).orderBy(dataSources.id);
  const out: SourceStatus[] = [];
  for (const s of sources) {
    const [last] = await db.select().from(ingestionRuns).where(eq(ingestionRuns.sourceId, s.id)).orderBy(desc(ingestionRuns.startedAt)).limit(1);
    const [ok] = await db
      .select({ at: ingestionRuns.finishedAt })
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.sourceId, s.id), eq(ingestionRuns.status, 'succeeded')))
      .orderBy(desc(ingestionRuns.finishedAt))
      .limit(1);
    const [fail] = await db
      .select({ at: ingestionRuns.finishedAt, error: ingestionRuns.error })
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.sourceId, s.id), eq(ingestionRuns.status, 'failed')))
      .orderBy(desc(ingestionRuns.finishedAt))
      .limit(1);
    out.push({
      key: s.key,
      name: s.name,
      kind: s.kind,
      isConfigured: s.isConfigured,
      lastSuccess: ok?.at?.toISOString() ?? null,
      lastFailure: fail?.at?.toISOString() ?? null,
      lastError: fail?.error ?? null,
      lastStatus: last?.status ?? null,
    });
  }
  return out;
}

export async function recentIngestionRuns(db: DB, limit = 30) {
  return db
    .select({
      id: ingestionRuns.id,
      source: dataSources.name,
      job: ingestionRuns.job,
      status: ingestionRuns.status,
      triggeredBy: ingestionRuns.triggeredBy,
      startedAt: ingestionRuns.startedAt,
      finishedAt: ingestionRuns.finishedAt,
      recordsIn: ingestionRuns.recordsIn,
      recordsWritten: ingestionRuns.recordsWritten,
      error: ingestionRuns.error,
    })
    .from(ingestionRuns)
    .innerJoin(dataSources, eq(dataSources.id, ingestionRuns.sourceId))
    .orderBy(desc(ingestionRuns.startedAt))
    .limit(limit);
}

export async function recentForecastRuns(db: DB, limit = 12) {
  return db
    .select({
      id: forecastRuns.id,
      scenario: forecastRuns.scenario,
      issuedFor: forecastRuns.issuedFor,
      status: forecastRuns.status,
      regionsCount: forecastRuns.regionsCount,
      createdAt: forecastRuns.createdAt,
      triggeredBy: forecastRuns.triggeredBy,
      isHindcast: forecastRuns.isHindcast,
      error: forecastRuns.error,
      model: modelVersions.key,
      inputs: forecastRuns.inputs,
    })
    .from(forecastRuns)
    .innerJoin(modelVersions, eq(modelVersions.id, forecastRuns.modelVersionId))
    .orderBy(desc(forecastRuns.createdAt))
    .limit(limit);
}

export async function operationalCounts(db: DB) {
  const [adv] = await db
    .select({
      total: count(),
      fallbacks: sql<number>`count(*) filter (where ${advisories.fallbackReason} is not null)::int`,
      published: sql<number>`count(*) filter (where ${advisories.status} = 'published')::int`,
      drafts: sql<number>`count(*) filter (where ${advisories.status} = 'draft')::int`,
    })
    .from(advisories);
  const byProvider = await db.select({ provider: advisories.provider, n: count() }).from(advisories).groupBy(advisories.provider);
  const [al] = await db
    .select({ total: count(), open: sql<number>`count(*) filter (where ${alerts.status} in ('active','acknowledged'))::int` })
    .from(alerts);
  const [nt] = await db.select({ total: count() }).from(notifications);
  const [unread] = await db.select({ n: count() }).from(notifications).where(isNull(notifications.readAt));
  return {
    advisories: { total: Number(adv.total), fallbacks: Number(adv.fallbacks), published: Number(adv.published), drafts: Number(adv.drafts), byProvider: byProvider.map((p) => ({ provider: p.provider, n: Number(p.n) })) },
    alerts: { total: Number(al.total), open: Number(al.open) },
    notifications: { total: Number(nt.total), unread: Number(unread.n) },
  };
}
