import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import { advisories, auditLogs, forecastRuns, forecasts, modelVersions, notifications, regions, roles, userRoles, users } from '@/server/db/schema';
import { seedReference } from '@/server/db/seed/reference';
import { loadUser, type AppUser } from '@/server/auth/users';
import { buildForecastBundle } from '@/server/advisories/bundle';
import { generateAdvisory, getAdvisory, listAdvisories, previewAdvisory, publishedPublicAdvisories, saveDraft, transitionAdvisory } from '@/server/advisories/service';
import { signPreview, verifyPreview } from '@/server/advisories/preview-token';
import { TemplateProvider } from '@/server/advisories/providers/template';
import { AdvisoryContentSchema } from '@/server/advisories/schema';
import { addDays, type Severity } from '@/lib/domain';

let db: DB;
let close: () => Promise<void>;
const R: Record<string, { id: number; path: string }> = {};
const U: Record<string, AppUser> = {};
let runId: string;
const template = new TemplateProvider();
const SECRET = 'test-secret-test-secret-test-secret-1234';

async function region(code: string, name: string, level: 'country' | 'state' | 'district' | 'city', parent: string | null) {
  const p = parent ? R[parent] : null;
  const [r] = await db
    .insert(regions)
    .values({ code, name, level, parentId: p?.id ?? null, path: p ? `${p.path}/${code}` : code, lat: 28, lon: 74, geoSource: 'test' })
    .returning({ id: regions.id, path: regions.path });
  R[code] = r;
}
async function user(key: string, role: string, regionCode: string | null) {
  const [u] = await db.insert(users).values({ email: `${key}@t.demo`, name: key, passwordHash: 'x' }).returning({ id: users.id });
  const [ro] = await db.select().from(roles).where(eq(roles.key, role));
  await db.insert(userRoles).values({ userId: u.id, roleId: ro.id, regionId: regionCode ? R[regionCode].id : null });
  U[key] = (await loadUser(db, u.id))!;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedReference(db);
  await region('IN', 'India', 'country', null);
  await region('IN-RJ', 'Rajasthan', 'state', 'IN');
  await region('IN-RJ-CHURU', 'Churu', 'district', 'IN-RJ');
  await region('IN-RJ-JAIPUR', 'Jaipur', 'district', 'IN-RJ');
  await region('IN-RJ-JAIPUR-C-JAIPUR', 'Jaipur', 'city', 'IN-RJ-JAIPUR');
  await region('IN-UP', 'Uttar Pradesh', 'state', 'IN');
  await user('analyst', 'climate_analyst', null);
  await user('rj_admin', 'state_admin', 'IN-RJ');
  await user('jaipur_admin', 'district_admin', 'IN-RJ-JAIPUR');
  await user('jaipur_field', 'field_responder', 'IN-RJ-JAIPUR');
  await user('up_official', 'disaster_official', 'IN-UP');
  await user('citizen', 'public', null);

  const [m] = await db.select().from(modelVersions).limit(1);
  const [run] = await db
    .insert(forecastRuns)
    .values({ modelVersionId: m.id, scenario: 'replay', issuedFor: '2024-05-26', horizonDays: 7, status: 'succeeded', isHindcast: true, triggeredBy: 'test', inputs: { nwp: 'Open-Meteo Previous Runs API — NWP as issued' } })
    .returning({ id: forecastRuns.id });
  runId = run.id;
  const rows: [string, number, Severity, number, number][] = [
    ['IN-RJ-CHURU', 1, 'extreme', 47.1, 0.75],
    ['IN-RJ-CHURU', 2, 'high', 46.5, 0.64],
    ['IN-RJ-CHURU', 3, 'moderate', 43.9, 0.52],
    ['IN-RJ-JAIPUR', 1, 'high', 45.3, 0.74],
    ['IN-RJ-JAIPUR', 2, 'moderate', 43.9, 0.68],
    ['IN-RJ-JAIPUR', 6, 'low', 40.1, 0.3], // beyond the advisory horizon
  ];
  for (const [code, h, sev, t, score] of rows) {
    await db.insert(forecasts).values({
      runId,
      regionId: R[code].id,
      targetDate: addDays('2024-05-26', h),
      horizonDay: h,
      resolution: 'district-centroid (point)',
      predictedTmaxC: t,
      lowerC: Math.round((t - 2.5) * 10) / 10,
      upperC: Math.round((t + 2.6) * 10) / 10,
      predictedTminC: 30.3,
      normalTmaxC: 40.4,
      departureC: Math.round((t - 40.4) * 10) / 10,
      severity: sev,
      imdCategory: sev === 'extreme' ? 'severe_heatwave' : sev === 'high' ? 'heatwave' : 'none',
      confidence: score >= 0.62 ? 'high' : 'medium',
      confidenceScore: score,
      durationDays: sev === 'extreme' || sev === 'high' ? 2 : 0,
      factors: [
        { key: 'classification', label: 'Classification rule', value: sev.toUpperCase(), impact: 'neutral', detail: `Tmax ${t.toFixed(1)} °C ≥ 45 °C absolute plains threshold` },
        { key: 'nwp', label: 'Numerical weather guidance', value: '47.6 °C', impact: 'raises', detail: 'Open-Meteo NWP guidance weighted at 85 % for day 1.' },
      ],
      inputKinds: ['reanalysis', 'climatology', 'nwp_forecast'],
    });
  }
});
afterAll(async () => close());

describe('forecast bundle', () => {
  it('is built from stored forecasts only, within the advisory horizon, with server-side sources', async () => {
    const b = await buildForecastBundle(db, { runId, regionCodes: ['IN-RJ-JAIPUR', 'IN-RJ-CHURU'], audience: 'government' });
    expect(b.regions.map((r) => r.code)).toEqual(['IN-RJ-CHURU', 'IN-RJ-JAIPUR']); // sorted by risk
    expect(b.summary).toMatchObject({ peakSeverity: 'extreme', peakTmaxC: 47.1, peakRegionCode: 'IN-RJ-CHURU' });
    expect(b.regions[1].days.every((d) => d.horizonDay <= 5)).toBe(true);
    expect(b.dataSources.map((s) => s.key)).toEqual(['climatiq-baseline', 'open-meteo-archive', 'open-meteo-previous-runs']);
    expect(b.officialWarnings.count).toBe(0);
    expect(b.notes.join(' ')).toMatch(/historical replay/);
  });

  it('maps cities to their district forecast and rejects unknown regions', async () => {
    const b = await buildForecastBundle(db, { runId, regionCodes: ['IN-RJ-JAIPUR-C-JAIPUR'], audience: 'public' });
    expect(b.regions[0].code).toBe('IN-RJ-JAIPUR');
    expect(b.notes.join(' ')).toMatch(/district forecast/);
    await expect(buildForecastBundle(db, { runId, regionCodes: ['IN-XX'], audience: 'public' })).rejects.toMatchObject({ status: 400 });
    await expect(buildForecastBundle(db, { runId, regionCodes: ['IN-UP'], audience: 'public' })).rejects.toMatchObject({ status: 422 });
  });
});

describe('advisory workflow', () => {
  let id: string;

  it('enforces advisory:generate per region', async () => {
    await expect(previewAdvisory(db, U.jaipur_field, { runId, regionCodes: ['IN-RJ-JAIPUR'], audience: 'field_team' })).rejects.toMatchObject({ status: 403 });
    await expect(previewAdvisory(db, U.jaipur_admin, { runId, regionCodes: ['IN-RJ-JAIPUR', 'IN-RJ-CHURU'], audience: 'field_team' })).rejects.toMatchObject({ status: 403 });
    await expect(previewAdvisory(db, U.up_official, { runId, regionCodes: ['IN-RJ-CHURU'], audience: 'public' })).rejects.toMatchObject({ status: 403 });
  });

  it('generates a draft with provenance, server-attached sources and the stored input bundle', async () => {
    const res = await generateAdvisory(db, U.analyst, { runId, regionCodes: ['IN-RJ-CHURU'], audience: 'public' }, { provider: template });
    id = res.id;
    const [row] = await db.select().from(advisories).where(eq(advisories.id, id));
    expect(row).toMatchObject({ status: 'draft', provider: 'template', severity: 'extreme', audience: 'public', validFrom: '2024-05-27', validTo: '2024-05-29' });
    expect(row.generatedBy).toBe(U.analyst.id);
    expect(row.promptVersion).toMatch(/advisory-template/);
    expect(AdvisoryContentSchema.safeParse(row.content).success).toBe(true);
    expect(row.sourceRefs.map((s) => s.kind)).toEqual(['model_forecast', 'reanalysis', 'nwp_forecast']);
    const [gen] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'advisory.generate'), eq(auditLogs.entityId, id)));
    expect((gen.after as { bundle: { bundleVersion: string } }).bundle.bundleVersion).toBe('forecast-bundle-v1');
    // approvers in scope are told a draft awaits review
    const n = await db.select().from(notifications).where(eq(notifications.advisoryId, id));
    expect(n.map((x) => x.userId).sort()).toEqual([U.rj_admin.id].sort());
  });

  it('keeps drafts internal until published', async () => {
    expect((await listAdvisories(db, U.citizen)).total).toBe(0);
    await expect(getAdvisory(db, U.citizen, id)).rejects.toMatchObject({ status: 403 });
    expect((await listAdvisories(db, U.jaipur_admin)).total).toBe(0); // Churu is outside Jaipur
    expect((await listAdvisories(db, U.rj_admin)).total).toBe(1);
    expect((await getAdvisory(db, U.rj_admin, id)).actions).toEqual(['approve', 'archive']);
    expect((await getAdvisory(db, U.analyst, id)).actions).toEqual(['archive']); // may discard own draft only
  });

  it('enforces the approve → publish order and advisory:approve', async () => {
    await expect(transitionAdvisory(db, U.analyst, id, 'approve')).rejects.toMatchObject({ status: 403 });
    await expect(transitionAdvisory(db, U.rj_admin, id, 'publish')).rejects.toMatchObject({ status: 409 });
    await expect(transitionAdvisory(db, U.up_official, id, 'approve')).rejects.toMatchObject({ status: 403 });
    await transitionAdvisory(db, U.rj_admin, id, 'approve');
    await transitionAdvisory(db, U.rj_admin, id, 'publish');
    const [row] = await db.select().from(advisories).where(eq(advisories.id, id));
    expect(row.status).toBe('published');
    expect(row.approvedBy).toBe(U.rj_admin.id);
    expect(row.publishedAt).toBeInstanceOf(Date);
    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['advisory.generate', 'advisory.approve', 'advisory.publish']));
  });

  it('exposes published public advisories to everyone and to the portal query', async () => {
    expect((await listAdvisories(db, U.citizen)).total).toBe(1);
    expect((await getAdvisory(db, U.citizen, id)).actions).toEqual([]);
    expect(await publishedPublicAdvisories(db, { regionCode: 'IN-RJ' })).toHaveLength(1); // ancestor of Churu
    expect(await publishedPublicAdvisories(db, { regionCode: 'IN-RJ-JAIPUR' })).toHaveLength(0);
    await transitionAdvisory(db, U.rj_admin, id, 'archive');
    expect(await publishedPublicAdvisories(db)).toHaveLength(0);
  });

  it('round-trips previews through a signed token that cannot be tampered with', async () => {
    const p = await previewAdvisory(db, U.jaipur_admin, { runId, regionCodes: ['IN-RJ-JAIPUR'], audience: 'field_team' }, { provider: template });
    const token = signPreview(U.jaipur_admin.id, p, SECRET);
    expect(verifyPreview<typeof p>(token, U.jaipur_admin.id, SECRET).title).toBe(p.title);
    expect(() => verifyPreview(token, U.rj_admin.id, SECRET)).toThrow(/another user/);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), payload: { ...p, severity: 'low' } })).toString('base64url');
    expect(() => verifyPreview(`${forged}.${sig}`, U.jaipur_admin.id, SECRET)).toThrow(/signature/);
    const { id: draft } = await saveDraft(db, U.jaipur_admin, verifyPreview(token, U.jaipur_admin.id, SECRET));
    expect((await getAdvisory(db, U.jaipur_field, draft)).status).toBe('draft'); // field responders can view internal drafts in scope
  });
});
