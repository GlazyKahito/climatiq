import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/types';
import { advisories, advisoryRegions, officialWarnings, regions } from '../db/schema';

/** Published advisories intended for the public (no internal content), optionally for a set of regions. */
export async function publicAdvisories(db: DB, regionIds?: number[], limit = 6) {
  const base = db
    .selectDistinct({
      id: advisories.id,
      title: advisories.title,
      severity: advisories.severity,
      validFrom: advisories.validFrom,
      validTo: advisories.validTo,
      summary: advisories.content,
      publishedAt: advisories.publishedAt,
      generatedAt: advisories.generatedAt,
      provider: advisories.provider,
    })
    .from(advisories)
    .innerJoin(advisoryRegions, eq(advisoryRegions.advisoryId, advisories.id));
  const conds = [eq(advisories.status, 'published'), eq(advisories.audience, 'public')];
  if (regionIds?.length) conds.push(inArray(advisoryRegions.regionId, regionIds));
  const rows = await base.where(and(...conds)).orderBy(desc(advisories.publishedAt)).limit(limit);
  return rows.map((r) => ({ ...r, summary: r.summary.summary, actions: r.summary.recommendedActions.slice(0, 4), publishedAt: r.publishedAt?.toISOString() ?? null, generatedAt: r.generatedAt.toISOString() }));
}

/** Official warnings that were retrieved from a verifiable source (empty until an IMD integration is configured). */
export async function verifiedOfficialWarnings(db: DB, regionIds?: number[]) {
  const conds = [eq(officialWarnings.verified, true)];
  if (regionIds?.length) conds.push(inArray(officialWarnings.regionId, regionIds));
  return db
    .select({ id: officialWarnings.id, title: officialWarnings.title, color: officialWarnings.colorCode, url: officialWarnings.url, issuedAt: officialWarnings.issuedAt, region: regions.name })
    .from(officialWarnings)
    .innerJoin(regions, eq(regions.id, officialWarnings.regionId))
    .where(and(...conds))
    .orderBy(desc(officialWarnings.issuedAt))
    .limit(10);
}
