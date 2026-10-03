/**
 * Advisory workflow (human-in-the-loop):
 *   generate (advisory:generate on every region) → draft → approve → publish (advisory:approve on every region) → archive
 * Every transition is audited. The exact forecast bundle used for generation is kept in the `advisory.generate` audit
 * record so reviewers can inspect the inputs.
 */
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/types';
import { advisories, advisoryRegions, auditLogs, forecastRuns, officialWarnings, regions, users, type AdvisoryContent } from '../db/schema';
import { audit } from '../audit/log';
import type { AppUser } from '../auth/users';
import { DomainError } from '../alerts/errors';
import { notifyUsers } from '../notifications/channels';
import { permissionHolders, recipientsFor } from '../notifications/recipients';
import { overlapsScopes } from '../alerts/scope';
import { can, scopesFor, type Permission } from '@/lib/rbac';
import { AUDIENCE_META, fmtDate, SEVERITY_META, type Severity } from '@/lib/domain';
import { buildForecastBundle } from './bundle';
import { generateAdvisoryContent, type GenerationResult } from './generate';
import { AdvisoryContentSchema, type AudienceKey, type ForecastBundle, type SourceRef } from './schema';
import type { AdvisoryProvider } from './providers/types';

export type AdvisoryStatus = 'draft' | 'approved' | 'published' | 'archived';
export type AdvisoryAction = 'approve' | 'publish' | 'archive';

export type AdvisoryPreview = {
  title: string;
  severity: Severity;
  audience: AudienceKey;
  confidence: 'low' | 'medium' | 'high';
  validFrom: string;
  validTo: string;
  expectedDurationDays: number;
  content: AdvisoryContent;
  sourceRefs: SourceRef[];
  provider: GenerationResult['provider'];
  requestedProvider: GenerationResult['requestedProvider'];
  modelName: string;
  promptVersion: string;
  fallbackReason: string | null;
  generatedAt: string;
  durationMs: number;
  runId: string;
  regionCodes: string[];
  bundle: ForecastBundle;
};

function assertCan(user: AppUser, perm: Permission, path: string, what = 'this region') {
  if (!can(user.assignments, perm, path)) throw new DomainError(403, `Missing permission ${perm} for ${what}`);
}

/** Source references are attached by the server from the bundle — never taken from model output. */
export function sourceRefsFor(bundle: ForecastBundle): SourceRef[] {
  return bundle.dataSources.map((s) => ({
    name: s.name,
    ...(s.url ? { url: s.url } : {}),
    kind: s.dataKind,
    retrievedAt: bundle.run.createdAt,
  }));
}

function shortWindow(from: string, to: string) {
  if (from === to) return fmtDate(from);
  return `${fmtDate(from, { day: 'numeric', month: 'short' })} – ${fmtDate(to)}`;
}

export function advisoryTitle(bundle: ForecastBundle) {
  const names = bundle.regions.map((r) => r.name);
  const where = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  return `${SEVERITY_META[bundle.summary.peakSeverity].label} heat risk advisory · ${where} · ${shortWindow(bundle.window.from, bundle.window.to)}`;
}

async function regionPaths(db: DB, codes: string[]) {
  const rows = await db.select({ id: regions.id, code: regions.code, name: regions.name, path: regions.path }).from(regions).where(inArray(regions.code, codes));
  const missing = codes.filter((c) => !rows.some((r) => r.code === c));
  if (missing.length) throw new DomainError(400, `Unknown region code(s): ${missing.join(', ')}`);
  return rows;
}

/** Generates (but does not store) an advisory. Requires advisory:generate on every selected region. */
export async function previewAdvisory(
  db: DB,
  user: AppUser,
  input: { runId: string; regionCodes: string[]; audience: AudienceKey },
  opts: { provider?: AdvisoryProvider | null; timeoutMs?: number } = {},
): Promise<AdvisoryPreview> {
  const codes = [...new Set(input.regionCodes)];
  for (const r of await regionPaths(db, codes)) assertCan(user, 'advisory:generate', r.path, r.name);
  const bundle = await buildForecastBundle(db, { runId: input.runId, regionCodes: codes, audience: input.audience });
  const gen = await generateAdvisoryContent(bundle, { provider: opts.provider, timeoutMs: opts.timeoutMs });
  return {
    title: advisoryTitle(bundle),
    severity: bundle.summary.peakSeverity,
    audience: input.audience,
    confidence: bundle.summary.confidence,
    validFrom: bundle.window.from,
    validTo: bundle.window.to,
    expectedDurationDays: bundle.summary.maxDurationDays,
    content: gen.content,
    sourceRefs: sourceRefsFor(bundle),
    provider: gen.provider,
    requestedProvider: gen.requestedProvider,
    modelName: gen.modelName,
    promptVersion: gen.promptVersion,
    fallbackReason: gen.fallbackReason,
    generatedAt: new Date().toISOString(),
    durationMs: gen.durationMs,
    runId: input.runId,
    regionCodes: bundle.regions.map((r) => r.code),
    bundle,
  };
}

/** Stores a generated preview as a draft (re-checks permissions; content is re-validated). */
export async function saveDraft(
  db: DB,
  user: AppUser,
  p: AdvisoryPreview,
  opts: { isDemo?: boolean; notify?: boolean; at?: Date } = {},
): Promise<{ id: string }> {
  const rs = await regionPaths(db, p.regionCodes);
  for (const r of rs) assertCan(user, 'advisory:generate', r.path, r.name);
  const content = AdvisoryContentSchema.parse(p.content);
  const at = opts.at ?? new Date(p.generatedAt);
  const [row] = await db
    .insert(advisories)
    .values({
      title: p.title.slice(0, 240),
      severity: p.severity,
      audience: p.audience,
      status: 'draft',
      forecastRunId: p.runId,
      validFrom: p.validFrom,
      validTo: p.validTo,
      expectedDurationDays: p.expectedDurationDays,
      confidence: p.confidence,
      content,
      sourceRefs: p.sourceRefs,
      provider: p.provider,
      modelName: p.modelName,
      promptVersion: p.promptVersion,
      fallbackReason: p.fallbackReason,
      generatedAt: at,
      generatedBy: user.id,
      isDemo: opts.isDemo ?? false,
    })
    .returning({ id: advisories.id });
  await db.insert(advisoryRegions).values(rs.map((r) => ({ advisoryId: row.id, regionId: r.id })));
  await audit(db, {
    actor: user,
    action: 'advisory.generate',
    entityType: 'advisory',
    entityId: row.id,
    regionId: rs.length === 1 ? rs[0].id : null,
    after: {
      status: 'draft',
      audience: p.audience,
      provider: p.provider,
      requestedProvider: p.requestedProvider,
      modelName: p.modelName,
      promptVersion: p.promptVersion,
      fallbackReason: p.fallbackReason,
      regions: p.regionCodes,
      bundle: p.bundle,
    },
  });
  if (opts.notify !== false) {
    const holders = await permissionHolders(db, 'advisory:approve');
    const recipients = [...new Set(rs.flatMap((r) => recipientsFor(holders, r.path, [user.id])))];
    await notifyUsers(db, recipients, {
      kind: 'advisory',
      severity: p.severity,
      title: `Advisory draft awaiting review · ${AUDIENCE_META[p.audience].label}`,
      body: `${p.title}. Generated by ${user.name} (${p.provider === 'template' ? 'deterministic template' : `${p.provider} · ${p.modelName}`}). Review and approve before publishing.`,
      link: `/advisories/${row.id}`,
      regionId: rs[0]?.id ?? null,
      advisoryId: row.id,
      isDemo: opts.isDemo ?? false,
    });
  }
  return { id: row.id };
}

export async function generateAdvisory(
  db: DB,
  user: AppUser,
  input: { runId: string; regionCodes: string[]; audience: AudienceKey },
  opts: { provider?: AdvisoryProvider | null; isDemo?: boolean; notify?: boolean; at?: Date } = {},
) {
  const preview = await previewAdvisory(db, user, input, { provider: opts.provider });
  const { id } = await saveDraft(db, user, preview, opts);
  return { id, preview };
}

const NEXT: Record<AdvisoryAction, { from: AdvisoryStatus[]; to: AdvisoryStatus }> = {
  approve: { from: ['draft'], to: 'approved' },
  publish: { from: ['approved'], to: 'published' },
  archive: { from: ['draft', 'approved', 'published'], to: 'archived' },
};

export function allowedActions(user: AppUser, adv: { status: AdvisoryStatus; generatedBy: string | null; regionPaths: string[] }): AdvisoryAction[] {
  const all = (perm: Permission) => adv.regionPaths.length > 0 && adv.regionPaths.every((p) => can(user.assignments, perm, p));
  const out: AdvisoryAction[] = [];
  for (const a of ['approve', 'publish', 'archive'] as AdvisoryAction[]) {
    if (!NEXT[a].from.includes(adv.status)) continue;
    if (all('advisory:approve')) out.push(a);
    else if (a === 'archive' && adv.status === 'draft' && adv.generatedBy === user.id && all('advisory:generate')) out.push(a); // discard own draft
  }
  return out;
}

async function advisoryRegionRows(db: DB, id: string) {
  return db
    .select({ id: regions.id, code: regions.code, name: regions.name, level: regions.level, path: regions.path })
    .from(advisoryRegions)
    .innerJoin(regions, eq(regions.id, advisoryRegions.regionId))
    .where(eq(advisoryRegions.advisoryId, id))
    .orderBy(asc(regions.name));
}

export async function transitionAdvisory(db: DB, user: AppUser, id: string, action: AdvisoryAction, opts: { at?: Date; notify?: boolean } = {}) {
  const [adv] = await db.select().from(advisories).where(eq(advisories.id, id)).limit(1);
  if (!adv) throw new DomainError(404, 'Advisory not found');
  const rs = await advisoryRegionRows(db, id);
  const step = NEXT[action];
  if (!step.from.includes(adv.status)) throw new DomainError(409, `Cannot ${action} an advisory that is ${adv.status}`);
  if (!allowedActions(user, { status: adv.status, generatedBy: adv.generatedBy, regionPaths: rs.map((r) => r.path) }).includes(action)) {
    throw new DomainError(403, `Missing permission to ${action} this advisory`);
  }
  const at = opts.at ?? new Date();
  const patch: Partial<typeof advisories.$inferInsert> = { status: step.to };
  if (action === 'approve') Object.assign(patch, { approvedBy: user.id, approvedAt: at });
  if (action === 'publish') Object.assign(patch, { publishedAt: at, ...(adv.approvedBy ? {} : { approvedBy: user.id, approvedAt: at }) });
  const updated = await db
    .update(advisories)
    .set(patch)
    .where(and(eq(advisories.id, id), eq(advisories.status, adv.status)))
    .returning({ id: advisories.id });
  if (!updated.length) throw new DomainError(409, 'Advisory was changed by someone else — reload and try again');
  await audit(db, {
    actor: user,
    action: `advisory.${action}`,
    entityType: 'advisory',
    entityId: id,
    regionId: rs.length === 1 ? rs[0].id : null,
    before: { status: adv.status },
    after: { status: step.to },
  });
  if (action === 'publish' && opts.notify !== false) {
    const holders = await permissionHolders(db, 'advisory:view_internal');
    const recipients = [...new Set(rs.flatMap((r) => recipientsFor(holders, r.path, [user.id])))];
    await notifyUsers(db, recipients, {
      kind: 'advisory',
      severity: adv.severity,
      title: `Advisory published · ${AUDIENCE_META[adv.audience].label}`,
      body: `${adv.title}. CLIMATIQ-generated decision support — not an official IMD warning.`,
      link: `/advisories/${id}`,
      regionId: rs[0]?.id ?? null,
      advisoryId: id,
      isDemo: adv.isDemo,
    });
  }
  return { id, status: step.to };
}

// ───────────────────────────── Queries ─────────────────────────────
export type AdvisoryFilters = {
  status?: AdvisoryStatus | 'all';
  audience?: AudienceKey;
  severity?: Severity;
  region?: string;
  scenario?: 'live' | 'replay';
  limit?: number;
  offset?: number;
};

export type AdvisoryListItem = {
  id: string;
  title: string;
  severity: Severity;
  audience: AudienceKey;
  status: AdvisoryStatus;
  validFrom: string;
  validTo: string;
  confidence: 'low' | 'medium' | 'high';
  provider: string;
  modelName: string;
  fallbackReason: string | null;
  generatedAt: string;
  publishedAt: string | null;
  generatedByName: string | null;
  scenario: 'live' | 'replay' | null;
  regionNames: string[];
  summary: string;
  isDemo: boolean;
};

const regionNamesSql = sql<string[]>`coalesce((select array_agg(r.name order by r.name) from advisory_regions ar join regions r on r.id = ar.region_id where ar.advisory_id = "advisories"."id"), '{}')`;

/** Visibility: published public advisories for everyone signed in; others need advisory:view_internal overlapping a region. */
function visibilityCond(user: AppUser): SQL {
  const publicPublished = sql`(${advisories.status} = 'published' and ${advisories.audience} = 'public')`;
  const scopes = scopesFor(user.assignments, 'advisory:view_internal');
  if (!scopes.length) return publicPublished;
  const overlap = overlapsScopes(sql`r.path`, scopes);
  if (!overlap) return sql`true`;
  return sql`(${publicPublished} or exists (select 1 from advisory_regions ar join regions r on r.id = ar.region_id where ar.advisory_id = "advisories"."id" and ${overlap}))`;
}

export async function listAdvisories(db: DB, user: AppUser, f: AdvisoryFilters = {}) {
  const conds: SQL[] = [visibilityCond(user)];
  if (f.status && f.status !== 'all') conds.push(eq(advisories.status, f.status));
  if (f.audience) conds.push(eq(advisories.audience, f.audience));
  if (f.severity) conds.push(eq(advisories.severity, f.severity));
  if (f.scenario) conds.push(eq(forecastRuns.scenario, f.scenario));
  if (f.region) {
    conds.push(
      sql`exists (select 1 from advisory_regions ar join regions r on r.id = ar.region_id where ar.advisory_id = "advisories"."id" and (r.code = ${f.region} or r.path like ${'%/' + f.region + '/%'} or r.path like ${'%/' + f.region}))`,
    );
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = await db
    .select({
      id: advisories.id,
      title: advisories.title,
      severity: advisories.severity,
      audience: advisories.audience,
      status: advisories.status,
      validFrom: advisories.validFrom,
      validTo: advisories.validTo,
      confidence: advisories.confidence,
      provider: advisories.provider,
      modelName: advisories.modelName,
      fallbackReason: advisories.fallbackReason,
      generatedAt: advisories.generatedAt,
      publishedAt: advisories.publishedAt,
      generatedByName: users.name,
      scenario: forecastRuns.scenario,
      regionNames: regionNamesSql,
      content: advisories.content,
      isDemo: advisories.isDemo,
    })
    .from(advisories)
    .leftJoin(users, eq(users.id, advisories.generatedBy))
    .leftJoin(forecastRuns, eq(forecastRuns.id, advisories.forecastRunId))
    .where(and(...conds))
    .orderBy(
      sql`case ${advisories.status} when 'draft' then 0 when 'approved' then 1 when 'published' then 2 else 3 end`,
      desc(advisories.generatedAt),
    )
    .limit(limit)
    .offset(Math.max(f.offset ?? 0, 0));
  const [{ n }] = await db
    .select({ n: count() })
    .from(advisories)
    .leftJoin(forecastRuns, eq(forecastRuns.id, advisories.forecastRunId))
    .where(and(...conds));
  const items: AdvisoryListItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    severity: r.severity,
    audience: r.audience,
    status: r.status,
    validFrom: r.validFrom,
    validTo: r.validTo,
    confidence: r.confidence,
    provider: r.provider,
    modelName: r.modelName,
    fallbackReason: r.fallbackReason,
    generatedAt: r.generatedAt.toISOString(),
    publishedAt: r.publishedAt?.toISOString() ?? null,
    generatedByName: r.generatedByName,
    scenario: r.scenario,
    regionNames: r.regionNames ?? [],
    summary: r.content.summary,
    isDemo: r.isDemo,
  }));
  return { items, total: Number(n) };
}

export async function getAdvisory(db: DB, user: AppUser, id: string) {
  const [row] = await db
    .select({
      adv: advisories,
      scenario: forecastRuns.scenario,
      issuedFor: forecastRuns.issuedFor,
      isHindcast: forecastRuns.isHindcast,
      generatedByName: sql<string | null>`(select u.name from users u where u.id = "advisories"."generated_by")`,
      approvedByName: sql<string | null>`(select u.name from users u where u.id = "advisories"."approved_by")`,
    })
    .from(advisories)
    .leftJoin(forecastRuns, eq(forecastRuns.id, advisories.forecastRunId))
    .where(eq(advisories.id, id))
    .limit(1);
  if (!row) throw new DomainError(404, 'Advisory not found');
  const rs = await advisoryRegionRows(db, id);
  const adv = row.adv;
  const isPublicPublished = adv.status === 'published' && adv.audience === 'public';
  const internalOk = rs.some((r) => {
    return user.assignments.some(
      (a) =>
        a.permissions.includes('advisory:view_internal') &&
        (a.regionPath == null || r.path === a.regionPath || r.path.startsWith(`${a.regionPath}/`) || a.regionPath.startsWith(`${r.path}/`)),
    );
  });
  if (!isPublicPublished && !internalOk) throw new DomainError(403, 'This advisory is not visible for your role or region');

  const [gen] = await db
    .select({ after: auditLogs.after })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, 'advisory'), eq(auditLogs.entityId, id), eq(auditLogs.action, 'advisory.generate')))
    .orderBy(asc(auditLogs.createdAt))
    .limit(1);
  const history = await db
    .select({ action: auditLogs.action, actor: auditLogs.actorLabel, at: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, 'advisory'), eq(auditLogs.entityId, id)))
    .orderBy(asc(auditLogs.createdAt));
  const bundle = ((gen?.after ?? null) as { bundle?: ForecastBundle } | null)?.bundle ?? null;

  return {
    id: adv.id,
    title: adv.title,
    severity: adv.severity,
    audience: adv.audience,
    status: adv.status,
    validFrom: adv.validFrom,
    validTo: adv.validTo,
    expectedDurationDays: adv.expectedDurationDays,
    confidence: adv.confidence,
    content: adv.content,
    sourceRefs: adv.sourceRefs,
    provider: adv.provider,
    modelName: adv.modelName,
    promptVersion: adv.promptVersion,
    fallbackReason: adv.fallbackReason,
    generatedAt: adv.generatedAt.toISOString(),
    generatedBy: adv.generatedBy,
    generatedByName: row.generatedByName,
    approvedByName: row.approvedByName,
    approvedAt: adv.approvedAt?.toISOString() ?? null,
    publishedAt: adv.publishedAt?.toISOString() ?? null,
    forecastRunId: adv.forecastRunId,
    scenario: row.scenario,
    issuedFor: row.issuedFor,
    isHindcast: row.isHindcast,
    isDemo: adv.isDemo,
    regions: rs,
    bundle,
    history: history.map((h) => {
      const at =
        h.action === 'advisory.generate' ? adv.generatedAt : h.action === 'advisory.approve' ? (adv.approvedAt ?? h.at) : h.action === 'advisory.publish' ? (adv.publishedAt ?? h.at) : h.at;
      return { action: h.action, actor: h.actor, at: at.toISOString() };
    }),
    actions: allowedActions(user, { status: adv.status, generatedBy: adv.generatedBy, regionPaths: rs.map((r) => r.path) }),
  };
}

/** Status counts visible to the user (tab badge / summary). */
export async function advisoryStatusCounts(db: DB, user: AppUser) {
  const rows = await db.select({ status: advisories.status, n: count() }).from(advisories).where(visibilityCond(user)).groupBy(advisories.status);
  const out: Record<AdvisoryStatus, number> = { draft: 0, approved: 0, published: 0, archived: 0 };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

/**
 * Published advisories for the general public (used by the public portal — no login required).
 * Only `status = published` AND `audience = public`.
 */
export async function publishedPublicAdvisories(db: DB, opts: { regionCode?: string; limit?: number } = {}) {
  const conds: SQL[] = [eq(advisories.status, 'published'), eq(advisories.audience, 'public')];
  if (opts.regionCode) {
    // The region itself, anything below it, or an ancestor (a state advisory applies to its districts).
    conds.push(
      sql`exists (select 1 from advisory_regions ar join regions r on r.id = ar.region_id, regions q where ar.advisory_id = "advisories"."id" and q.code = ${opts.regionCode} and (r.id = q.id or r.path like q.path || '/%' or q.path like r.path || '/%'))`,
    );
  }
  const rows = await db
    .select({
      id: advisories.id,
      title: advisories.title,
      severity: advisories.severity,
      validFrom: advisories.validFrom,
      validTo: advisories.validTo,
      confidence: advisories.confidence,
      content: advisories.content,
      sourceRefs: advisories.sourceRefs,
      provider: advisories.provider,
      modelName: advisories.modelName,
      publishedAt: advisories.publishedAt,
      scenario: forecastRuns.scenario,
      regionNames: regionNamesSql,
    })
    .from(advisories)
    .leftJoin(forecastRuns, eq(forecastRuns.id, advisories.forecastRunId))
    .where(and(...conds))
    .orderBy(desc(advisories.publishedAt))
    .limit(Math.min(opts.limit ?? 20, 100));
  return rows.map((r) => ({ ...r, publishedAt: r.publishedAt?.toISOString() ?? null, regionNames: r.regionNames ?? [] }));
}

/** Verified official (IMD) warnings, kept separate from CLIMATIQ content. Currently none are ingested. */
export async function officialWarningsFor(db: DB, regionIds?: number[]) {
  const rows = await db
    .select({
      id: officialWarnings.id,
      title: officialWarnings.title,
      colorCode: officialWarnings.colorCode,
      url: officialWarnings.url,
      issuedAt: officialWarnings.issuedAt,
      regionName: regions.name,
    })
    .from(officialWarnings)
    .innerJoin(regions, eq(regions.id, officialWarnings.regionId))
    .where(and(eq(officialWarnings.verified, true), regionIds?.length ? inArray(officialWarnings.regionId, regionIds) : undefined))
    .orderBy(desc(officialWarnings.issuedAt))
    .limit(20);
  return rows.map((r) => ({ ...r, issuedAt: r.issuedAt.toISOString() }));
}
