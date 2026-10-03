import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';
import type { DB } from '@/server/db/types';
import { auditLogs, incidentActivities, incidents, notifications, regions, roles, teamMembers, teams, userRoles, users } from '@/server/db/schema';
import { seedReference } from '@/server/db/seed/reference';
import { loadUser, type AppUser } from '@/server/auth/users';
import {
  addNote,
  assignIncident,
  createIncident,
  createTask,
  dashboard,
  deleteTask,
  getIncident,
  listIncidents,
  transitionIncident,
  updateTask,
} from '@/server/incidents/service';

let db: DB;
let close: () => Promise<void>;
const R: Record<string, { id: number; path: string }> = {};
const U: Record<string, AppUser> = {};
let jaipurTeam: number;

async function region(code: string, level: 'country' | 'state' | 'district', parent: string | null) {
  const p = parent ? R[parent] : null;
  const [r] = await db
    .insert(regions)
    .values({ code, name: code, level, parentId: p?.id ?? null, path: p ? `${p.path}/${code}` : code, lat: 26, lon: 75, geoSource: 'test' })
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
  await region('IN', 'country', null);
  await region('IN-RJ', 'state', 'IN');
  await region('IN-RJ-JAIPUR', 'district', 'IN-RJ');
  await region('IN-RJ-CHURU', 'district', 'IN-RJ');
  await region('IN-UP', 'state', 'IN');
  await user('rj_admin', 'state_admin', 'IN-RJ');
  await user('rj_response', 'response_team', 'IN-RJ');
  await user('jaipur_admin', 'district_admin', 'IN-RJ-JAIPUR');
  await user('jaipur_field', 'field_responder', 'IN-RJ-JAIPUR');
  await user('analyst', 'climate_analyst', null);
  await user('up_official', 'disaster_official', 'IN-UP');
  const [t] = await db.insert(teams).values({ name: 'Jaipur District Response Team', kind: 'district_response', regionId: R['IN-RJ-JAIPUR'].id }).returning({ id: teams.id });
  jaipurTeam = t.id;
  await db.insert(teamMembers).values([
    { teamId: t.id, userId: U.jaipur_admin.id, isLead: true },
    { teamId: t.id, userId: U.jaipur_field.id },
  ]);
  await db.insert(teams).values({ name: 'UP cell', kind: 'state_eoc', regionId: R['IN-UP'].id });
});
afterAll(async () => close());

const base = { description: 'Demo scenario (fictional) based on May 2024 replay.', severity: 'high' as const, priority: 'p2' as const };

describe('incident creation & refs', () => {
  it('creates sequential INC-YYYY-NNNN refs with a created activity and audit record', async () => {
    const a = await createIncident(db, U.rj_response, { ...base, title: 'Water points at worksites', regionCode: 'IN-RJ-JAIPUR' });
    const b = await createIncident(db, U.rj_admin, { ...base, title: 'Hospital cooling', regionCode: 'IN-RJ-CHURU' });
    const year = new Date().getUTCFullYear();
    expect(a.ref).toBe(`INC-${year}-0001`);
    expect(b.ref).toBe(`INC-${year}-0002`);
    const acts = await db.select().from(incidentActivities).where(eq(incidentActivities.incidentId, a.id));
    expect(acts.map((x) => x.kind)).toContain('created');
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, 'incident.create'))).length).toBe(2);
  });

  it('enforces incident:create by region', async () => {
    await expect(createIncident(db, U.jaipur_field, { ...base, title: 'x', regionCode: 'IN-RJ-JAIPUR' })).rejects.toMatchObject({ status: 403 });
    await expect(createIncident(db, U.rj_admin, { ...base, title: 'x', regionCode: 'IN-UP' })).rejects.toMatchObject({ status: 403 });
    await expect(createIncident(db, U.analyst, { ...base, title: 'x', regionCode: 'IN-RJ-JAIPUR' })).rejects.toMatchObject({ status: 403 });
  });

  it('requires incident:assign to assign at creation', async () => {
    await expect(
      createIncident(db, U.rj_response, { ...base, title: 'x', regionCode: 'IN-RJ-JAIPUR', ownerId: U.rj_response.id }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('assignment', () => {
  it('assigns team + owner, validates eligibility and notifies assignees', async () => {
    const ref = `INC-${new Date().getUTCFullYear()}-0001`;
    await expect(assignIncident(db, U.rj_response, ref, { ownerId: U.rj_response.id })).rejects.toMatchObject({ status: 403 });
    const [upTeam] = await db.select().from(teams).where(eq(teams.name, 'UP cell'));
    await expect(assignIncident(db, U.rj_admin, ref, { teamId: upTeam.id })).rejects.toMatchObject({ status: 422 });
    await expect(assignIncident(db, U.rj_admin, ref, { ownerId: U.jaipur_field.id })).rejects.toMatchObject({ status: 422 }); // cannot update incidents
    await assignIncident(db, U.rj_admin, ref, { teamId: jaipurTeam, ownerId: U.jaipur_admin.id });
    const notes = await db.select().from(notifications).where(sql`${notifications.kind} = 'incident'`);
    const recipients = notes.map((n) => n.userId).sort();
    expect(recipients).toEqual([U.jaipur_admin.id, U.jaipur_field.id].sort());
    expect(notes[0].link).toBe(`/response/incidents/${ref}`);
  });
});

describe('status transitions', () => {
  const ref = () => `INC-${new Date().getUTCFullYear()}-0001`;

  it('validates transitions server-side', async () => {
    await expect(transitionIncident(db, U.rj_response, ref(), 'monitoring')).rejects.toMatchObject({ status: 422 });
    await transitionIncident(db, U.rj_response, ref(), 'triaged');
    await transitionIncident(db, U.jaipur_admin, ref(), 'in_progress');
    await expect(transitionIncident(db, U.jaipur_field, ref(), 'monitoring')).rejects.toMatchObject({ status: 403 });
  });

  it('requires incident:close and a resolution summary to resolve', async () => {
    await expect(transitionIncident(db, U.rj_response, ref(), 'resolved', { resolutionSummary: 'All worksites now have water.' })).rejects.toMatchObject({ status: 403 });
    await expect(transitionIncident(db, U.jaipur_admin, ref(), 'resolved')).rejects.toMatchObject({ status: 422 });
    await transitionIncident(db, U.jaipur_admin, ref(), 'resolved', { resolutionSummary: 'All worksites now have water and shade.' });
    await transitionIncident(db, U.rj_admin, ref(), 'closed');
    const [row] = await db.select().from(incidents).where(eq(incidents.ref, ref()));
    expect(row.status).toBe('closed');
    expect(row.resolutionSummary).toMatch(/water and shade/);
    expect(row.closedAt).toBeInstanceOf(Date);
  });

  it('can be reopened by users with incident:close', async () => {
    await expect(transitionIncident(db, U.rj_response, ref(), 'in_progress')).rejects.toMatchObject({ status: 403 });
    await transitionIncident(db, U.rj_admin, ref(), 'in_progress');
    const [row] = await db.select().from(incidents).where(eq(incidents.ref, ref()));
    expect(row.status).toBe('in_progress');
    expect(row.closedAt).toBeNull();
    const detail = await getIncident(db, U.rj_admin, ref());
    expect(detail.activities.filter((a) => a.kind === 'status_change')).toHaveLength(5);
  });

  it('the database rejects resolved/closed incidents without a summary', async () => {
    await expect(db.update(incidents).set({ status: 'resolved', resolutionSummary: null }).where(eq(incidents.ref, ref()))).rejects.toThrow();
  });
});

describe('tasks', () => {
  const ref = () => `INC-${new Date().getUTCFullYear()}-0001`;
  let taskId: string;

  it('managers create tasks; assignees get notified; field responders cannot create', async () => {
    await expect(createTask(db, U.jaipur_field, ref(), { title: 'Inspect sites' })).rejects.toMatchObject({ status: 403 });
    await expect(createTask(db, U.jaipur_admin, ref(), { title: 'Inspect sites', assigneeId: U.up_official.id })).rejects.toMatchObject({ status: 422 });
    ({ id: taskId } = await createTask(db, U.jaipur_admin, ref(), { title: 'Inspect five construction sites', assigneeId: U.jaipur_field.id, priority: 'p2' }));
    const n = await db.select().from(notifications).where(eq(notifications.userId, U.jaipur_field.id));
    expect(n.some((x) => x.title.startsWith('New task'))).toBe(true);
  });

  it('field responders may update only the status of their own tasks', async () => {
    await updateTask(db, U.jaipur_field, ref(), taskId, { status: 'in_progress' });
    await expect(updateTask(db, U.jaipur_field, ref(), taskId, { title: 'Renamed' })).rejects.toMatchObject({ status: 403 });
    const { id: other } = await createTask(db, U.jaipur_admin, ref(), { title: 'Brief the labour department', assigneeId: U.jaipur_admin.id });
    await expect(updateTask(db, U.jaipur_field, ref(), other, { status: 'done' })).rejects.toMatchObject({ status: 403 });
    await updateTask(db, U.jaipur_field, ref(), taskId, { status: 'done' });
    const detail = await getIncident(db, U.jaipur_field, ref());
    const t = detail.tasks.find((x) => x.id === taskId)!;
    expect(t.status).toBe('done');
    expect(t.completedAt).not.toBeNull();
    expect(detail.permissions.update).toBe(false);
    expect(detail.permissions.note).toBe(true);
    await deleteTask(db, U.jaipur_admin, ref(), other);
    await expect(deleteTask(db, U.jaipur_field, ref(), taskId)).rejects.toMatchObject({ status: 403 });
  });

  it('assignees with a task may add notes; others need incident:update', async () => {
    await addNote(db, U.jaipur_field, ref(), 'Site 3 has no shade; supervisor informed.');
    await expect(addNote(db, U.analyst, ref(), 'hello there')).rejects.toMatchObject({ status: 403 });
  });
});

describe('lists, detail visibility & dashboard', () => {
  it('scopes incidents by region', async () => {
    const field = await listIncidents(db, U.jaipur_field, { status: 'all' });
    expect(field.items.map((i) => i.regionCode)).toEqual(['IN-RJ-JAIPUR']);
    const state = await listIncidents(db, U.rj_admin, { status: 'all' });
    expect(state.total).toBe(2);
    const up = await listIncidents(db, U.up_official, { status: 'all' });
    expect(up.total).toBe(0);
    await expect(getIncident(db, U.up_official, `INC-${new Date().getUTCFullYear()}-0002`)).rejects.toMatchObject({ status: 403 });
    await expect(getIncident(db, U.jaipur_field, `INC-${new Date().getUTCFullYear()}-0002`)).rejects.toMatchObject({ status: 403 });
  });

  it('filters overdue and mine', async () => {
    const ref2 = `INC-${new Date().getUTCFullYear()}-0002`;
    await db.update(incidents).set({ dueAt: new Date(Date.now() - 3600_000) }).where(eq(incidents.ref, ref2));
    const overdue = await listIncidents(db, U.rj_admin, { overdue: true });
    expect(overdue.items.map((i) => i.ref)).toEqual([ref2]);
    expect(overdue.items[0].overdue).toBe(true);
    const mine = await listIncidents(db, U.jaipur_field, { mine: true, status: 'all' });
    expect(mine.total).toBe(1);
  });

  it('builds a scoped dashboard', async () => {
    const d = await dashboard(db, U.rj_admin);
    expect(d.totals.active).toBe(2);
    expect(d.byStatus.in_progress).toBe(1);
    expect(d.byRegion[0]).toMatchObject({ code: 'IN-RJ', active: 2 });
    expect(d.totals.overdueIncidents).toBe(1);
    expect(d.teamWorkload.find((t) => t.id === jaipurTeam)).toMatchObject({ activeIncidents: 1 });
    expect(d.recentActivity.length).toBeGreaterThan(3);
    const up = await dashboard(db, U.up_official);
    expect(up.totals.total).toBe(0);
    expect(up.teamWorkload.map((t) => t.name)).toEqual(['UP cell']);
  });
});
