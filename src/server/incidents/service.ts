/**
 * Heatwave response CRM: incidents, assignment, notes, tasks and activity — all region-scoped and audited.
 * Functions take (db, actor) so authorisation is enforced here (and testable), not only in routes/actions.
 */
import { and, asc, count, desc, eq, ilike, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/types';
import { advisories, alerts, incidentActivities, incidents, incidentTasks, regions, teamMembers, teams, users } from '../db/schema';
import { audit } from '../audit/log';
import type { AppUser } from '../auth/users';
import { DomainError } from '../alerts/errors';
import { notifyUsers } from '../notifications/channels';
import { permissionHolders, recipientsFor } from '../notifications/recipients';
import { withinScopes } from '../alerts/scope';
import { can, pathWithin, scopesFor, type Permission } from '@/lib/rbac';
import type { IncidentStatus, Priority, Severity } from '@/lib/domain';
import { ACTIVE_STATUSES, INCIDENT_FLOW, isReopen, permissionForTransition, transitionLabel, validateTransition } from './workflow';

type Actor = AppUser;
type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

function assertCan(user: Actor, perm: Permission, path: string) {
  if (!can(user.assignments, perm, path)) throw new DomainError(403, `Missing permission ${perm} for this region`);
}

const link = (ref: string) => `/response/incidents/${ref}`;

// ───────────────────────────── Refs ─────────────────────────────
export async function nextRef(db: DB, year: number) {
  const prefix = `INC-${year}-`;
  const [last] = await db
    .select({ ref: incidents.ref })
    .from(incidents)
    .where(sql`${incidents.ref} like ${prefix + '%'}`)
    .orderBy(desc(incidents.ref))
    .limit(1);
  const n = last ? Number(last.ref.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

async function loadIncident(db: DB, ref: string) {
  const [row] = await db
    .select({ inc: incidents, path: regions.path, regionName: regions.name, regionCode: regions.code })
    .from(incidents)
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .where(eq(incidents.ref, ref))
    .limit(1);
  if (!row) throw new DomainError(404, `Incident ${ref} not found`);
  return row;
}

async function activity(db: DB, incidentId: string, actorId: string | null, kind: string, body: string, meta: Record<string, unknown> = {}, at?: Date) {
  await db.insert(incidentActivities).values({ incidentId, actorId, kind, body: body.slice(0, 2000), meta, ...(at ? { createdAt: at } : {}) });
}

// ───────────────────────────── Assignment eligibility ─────────────────────────────
/** Teams whose region is the incident region, an ancestor or a descendant of it. */
export async function eligibleTeams(db: DB, regionPath: string) {
  const rows = await db
    .select({ id: teams.id, name: teams.name, kind: teams.kind, regionName: regions.name, path: regions.path })
    .from(teams)
    .innerJoin(regions, eq(regions.id, teams.regionId))
    .orderBy(asc(teams.name));
  return rows.filter((t) => pathWithin(regionPath, t.path) || pathWithin(t.path, regionPath));
}

/** Active users holding `perm` on the region (e.g. incident:update for owners, task:update for task assignees). */
export async function eligibleUsers(db: DB, perm: Permission, regionPath: string) {
  const ids = recipientsFor(await permissionHolders(db, perm), regionPath);
  if (!ids.length) return [];
  return db
    .select({ id: users.id, name: users.name, designation: users.designation })
    .from(users)
    .where(inArray(users.id, ids))
    .orderBy(asc(users.name));
}

async function teamMemberIds(db: DB, teamId: number) {
  return (await db.select({ id: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamId, teamId))).map((m) => m.id);
}

// ───────────────────────────── Create ─────────────────────────────
export type CreateIncidentInput = {
  title: string;
  description: string;
  regionCode: string;
  severity: Severity;
  priority: Priority;
  alertId?: string | null;
  advisoryId?: string | null;
  teamId?: number | null;
  ownerId?: string | null;
  dueAt?: Date | null;
};

export async function createIncident(db: DB, user: Actor, input: CreateIncidentInput, opts: { isDemo?: boolean; at?: Date; notify?: boolean } = {}) {
  const [region] = await db.select({ id: regions.id, path: regions.path, name: regions.name }).from(regions).where(eq(regions.code, input.regionCode)).limit(1);
  if (!region) throw new DomainError(400, `Unknown region ${input.regionCode}`);
  assertCan(user, 'incident:create', region.path);
  if (input.alertId) {
    const [a] = await db.select({ id: alerts.id }).from(alerts).where(eq(alerts.id, input.alertId)).limit(1);
    if (!a) throw new DomainError(400, 'Linked alert not found');
  }
  if (input.advisoryId) {
    const [a] = await db.select({ id: advisories.id }).from(advisories).where(eq(advisories.id, input.advisoryId)).limit(1);
    if (!a) throw new DomainError(400, 'Linked advisory not found');
  }
  if (input.teamId != null || input.ownerId != null) {
    assertCan(user, 'incident:assign', region.path);
    await assertEligible(db, region.path, input.teamId ?? null, input.ownerId ?? null);
  }
  const at = opts.at ?? new Date();
  let created: { id: string; ref: string } | undefined;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const ref = await nextRef(db, at.getUTCFullYear());
    const rows = await db
      .insert(incidents)
      .values({
        ref,
        title: input.title.trim().slice(0, 200),
        description: input.description.trim().slice(0, 5000),
        regionId: region.id,
        severity: input.severity,
        priority: input.priority,
        status: 'reported',
        alertId: input.alertId ?? null,
        advisoryId: input.advisoryId ?? null,
        teamId: input.teamId ?? null,
        ownerId: input.ownerId ?? null,
        dueAt: input.dueAt ?? null,
        openedBy: user.id,
        openedAt: at,
        updatedAt: at,
        isDemo: opts.isDemo ?? false,
      })
      .onConflictDoNothing({ target: incidents.ref })
      .returning({ id: incidents.id, ref: incidents.ref });
    created = rows[0];
  }
  if (!created) throw new DomainError(409, 'Could not allocate an incident reference — retry');

  await activity(db, created.id, user.id, 'created', `Incident reported in ${region.name}.`, { severity: input.severity, priority: input.priority }, at);
  if (input.alertId) await activity(db, created.id, user.id, 'link', 'Linked to a CLIMATIQ alert.', { alertId: input.alertId }, at);
  if (input.advisoryId) await activity(db, created.id, user.id, 'link', 'Linked to a CLIMATIQ advisory.', { advisoryId: input.advisoryId }, at);
  await audit(db, {
    actor: user,
    action: 'incident.create',
    entityType: 'incident',
    entityId: created.id,
    regionId: region.id,
    after: { ref: created.ref, title: input.title, severity: input.severity, priority: input.priority, alertId: input.alertId ?? null, advisoryId: input.advisoryId ?? null },
  });
  if (input.teamId != null || input.ownerId != null) {
    await recordAssignment(db, user, { id: created.id, ref: created.ref, title: input.title, regionId: region.id, severity: input.severity }, { teamId: null, ownerId: null }, { teamId: input.teamId ?? null, ownerId: input.ownerId ?? null }, { at, isDemo: opts.isDemo, notify: opts.notify });
  }
  return created;
}

async function assertEligible(db: DB, regionPath: string, teamId: number | null, ownerId: string | null) {
  if (teamId != null && !(await eligibleTeams(db, regionPath)).some((t) => t.id === teamId)) {
    throw new DomainError(422, 'That team does not cover this region');
  }
  if (ownerId != null && !(await eligibleUsers(db, 'incident:update', regionPath)).some((u) => u.id === ownerId)) {
    throw new DomainError(422, 'The owner must be able to update incidents in this region');
  }
}

async function recordAssignment(
  db: DB,
  user: Actor,
  inc: { id: string; ref: string; title: string; regionId: number; severity: Severity },
  before: { teamId: number | null; ownerId: string | null },
  after: { teamId: number | null; ownerId: string | null },
  opts: { at?: Date; isDemo?: boolean; notify?: boolean } = {},
) {
  const parts: string[] = [];
  const recipients = new Set<string>();
  if (after.teamId !== before.teamId) {
    const [t] = after.teamId != null ? await db.select({ name: teams.name }).from(teams).where(eq(teams.id, after.teamId)) : [];
    parts.push(after.teamId != null ? `Assigned to team ${t?.name ?? after.teamId}` : 'Team assignment removed');
    if (after.teamId != null) for (const m of await teamMemberIds(db, after.teamId)) recipients.add(m);
  }
  if (after.ownerId !== before.ownerId) {
    const [u] = after.ownerId != null ? await db.select({ name: users.name }).from(users).where(eq(users.id, after.ownerId)) : [];
    parts.push(after.ownerId != null ? `Owner set to ${u?.name ?? 'user'}` : 'Owner removed');
    if (after.ownerId != null) recipients.add(after.ownerId);
  }
  if (!parts.length) return;
  await activity(db, inc.id, user.id, 'assignment', `${parts.join('; ')}.`, { before, after }, opts.at);
  await audit(db, { actor: user, action: 'incident.assign', entityType: 'incident', entityId: inc.id, regionId: inc.regionId, before, after });
  recipients.delete(user.id);
  if (opts.notify !== false && recipients.size) {
    await notifyUsers(db, [...recipients], {
      kind: 'incident',
      severity: inc.severity,
      title: `Assigned: ${inc.ref}`,
      body: `${inc.title} — ${parts.join('; ')} by ${user.name}.`,
      link: link(inc.ref),
      regionId: inc.regionId,
      incidentId: inc.id,
      isDemo: opts.isDemo ?? false,
      createdAt: opts.at,
    });
  }
}

// ───────────────────────────── Update / assign / transition / notes ─────────────────────────────
export async function assignIncident(db: DB, user: Actor, ref: string, patch: { teamId?: number | null; ownerId?: string | null }, opts: { at?: Date; isDemo?: boolean; notify?: boolean } = {}) {
  const { inc, path } = await loadIncident(db, ref);
  assertCan(user, 'incident:assign', path);
  const after = { teamId: patch.teamId === undefined ? inc.teamId : patch.teamId, ownerId: patch.ownerId === undefined ? inc.ownerId : patch.ownerId };
  await assertEligible(db, path, after.teamId !== inc.teamId ? after.teamId : null, after.ownerId !== inc.ownerId ? after.ownerId : null);
  const at = opts.at ?? new Date();
  await db.update(incidents).set({ teamId: after.teamId, ownerId: after.ownerId, updatedAt: at }).where(eq(incidents.id, inc.id));
  await recordAssignment(db, user, inc, { teamId: inc.teamId, ownerId: inc.ownerId }, after, { ...opts, at, isDemo: opts.isDemo ?? inc.isDemo });
  return { ref, ...after };
}

export async function updateIncident(
  db: DB,
  user: Actor,
  ref: string,
  patch: { title?: string; description?: string; priority?: Priority; severity?: Severity; dueAt?: Date | null },
) {
  const { inc, path } = await loadIncident(db, ref);
  assertCan(user, 'incident:update', path);
  const set: Partial<typeof incidents.$inferInsert> = {};
  const changes: string[] = [];
  if (patch.title !== undefined && patch.title.trim() !== inc.title) {
    set.title = patch.title.trim().slice(0, 200);
    changes.push('title');
  }
  if (patch.description !== undefined && patch.description.trim() !== inc.description) {
    set.description = patch.description.trim().slice(0, 5000);
    changes.push('description');
  }
  if (patch.priority && patch.priority !== inc.priority) {
    set.priority = patch.priority;
    changes.push(`priority ${inc.priority.toUpperCase()} → ${patch.priority.toUpperCase()}`);
  }
  if (patch.severity && patch.severity !== inc.severity) {
    set.severity = patch.severity;
    changes.push(`severity ${inc.severity} → ${patch.severity}`);
  }
  if (patch.dueAt !== undefined && (patch.dueAt?.getTime() ?? null) !== (inc.dueAt?.getTime() ?? null)) {
    set.dueAt = patch.dueAt;
    changes.push(patch.dueAt ? `due date set to ${patch.dueAt.toISOString().slice(0, 10)}` : 'due date cleared');
  }
  if (!changes.length) return { ref, changed: [] as string[] };
  set.updatedAt = new Date();
  await db.update(incidents).set(set).where(eq(incidents.id, inc.id));
  await activity(db, inc.id, user.id, 'update', `Updated ${changes.join(', ')}.`, { fields: Object.keys(set) });
  await audit(db, {
    actor: user,
    action: 'incident.update',
    entityType: 'incident',
    entityId: inc.id,
    regionId: inc.regionId,
    before: Object.fromEntries(Object.keys(set).filter((k) => k !== 'updatedAt').map((k) => [k, (inc as Record<string, unknown>)[k]])),
    after: Object.fromEntries(Object.entries(set).filter(([k]) => k !== 'updatedAt')),
  });
  return { ref, changed: changes };
}

export async function transitionIncident(
  db: DB,
  user: Actor,
  ref: string,
  to: IncidentStatus,
  opts: { resolutionSummary?: string | null; note?: string | null; at?: Date } = {},
) {
  const { inc, path } = await loadIncident(db, ref);
  assertCan(user, permissionForTransition(inc.status, to), path);
  const check = validateTransition(inc.status, to, { resolutionSummary: opts.resolutionSummary, existingSummary: inc.resolutionSummary });
  if (!check.ok) throw new DomainError(422, check.reason);
  const at = opts.at ?? new Date();
  const set: Partial<typeof incidents.$inferInsert> = { status: to, updatedAt: at };
  const summary = opts.resolutionSummary?.trim();
  if (summary) set.resolutionSummary = summary.slice(0, 4000);
  if (to === 'resolved') set.resolvedAt = at;
  if (to === 'closed') {
    set.closedAt = at;
    if (!inc.resolvedAt) set.resolvedAt = at;
  }
  if (isReopen(inc.status, to)) Object.assign(set, { resolvedAt: null, closedAt: null });
  const updated = await db
    .update(incidents)
    .set(set)
    .where(and(eq(incidents.id, inc.id), eq(incidents.status, inc.status)))
    .returning({ id: incidents.id });
  if (!updated.length) throw new DomainError(409, 'Incident was updated by someone else — reload and try again');
  const label = transitionLabel(inc.status, to);
  await activity(
    db,
    inc.id,
    user.id,
    'status_change',
    `${label}: ${inc.status.replace('_', ' ')} → ${to.replace('_', ' ')}.${summary ? ` Resolution: ${summary}` : ''}${opts.note?.trim() ? ` Note: ${opts.note.trim()}` : ''}`,
    { from: inc.status, to },
    at,
  );
  await audit(db, { actor: user, action: 'incident.status_change', entityType: 'incident', entityId: inc.id, regionId: inc.regionId, before: { status: inc.status }, after: { status: to, resolutionSummary: summary ?? null } });
  return { ref, from: inc.status, to };
}

export async function addNote(db: DB, user: Actor, ref: string, body: string, opts: { at?: Date } = {}) {
  const text = body.trim();
  if (text.length < 2) throw new DomainError(422, 'Note is empty');
  const { inc, path } = await loadIncident(db, ref);
  const hasTask =
    (await db.select({ n: count() }).from(incidentTasks).where(and(eq(incidentTasks.incidentId, inc.id), eq(incidentTasks.assigneeId, user.id))))[0].n > 0;
  if (!can(user.assignments, 'incident:update', path) && !(hasTask && can(user.assignments, 'task:update', path))) {
    throw new DomainError(403, 'Missing permission incident:update for this region');
  }
  const at = opts.at ?? new Date();
  await activity(db, inc.id, user.id, 'note', text.slice(0, 2000), {}, at);
  await db.update(incidents).set({ updatedAt: at }).where(eq(incidents.id, inc.id));
  await audit(db, { actor: user, action: 'incident.note', entityType: 'incident', entityId: inc.id, regionId: inc.regionId, after: { length: text.length } });
  return { ok: true };
}

// ───────────────────────────── Tasks ─────────────────────────────
export type TaskInput = { title: string; priority?: Priority; assigneeId?: string | null; dueAt?: Date | null; status?: TaskStatus };

async function assertTaskAssignee(db: DB, path: string, assigneeId: string | null | undefined) {
  if (assigneeId == null) return;
  if (!(await eligibleUsers(db, 'task:update', path)).some((u) => u.id === assigneeId)) {
    throw new DomainError(422, 'The assignee must be able to update tasks in this region');
  }
}

async function notifyTaskAssignee(
  db: DB,
  user: Actor,
  inc: { id: string; ref: string; regionId: number; severity: Severity; isDemo: boolean },
  task: { title: string; assigneeId: string | null },
  at?: Date,
) {
  if (!task.assigneeId || task.assigneeId === user.id) return;
  await notifyUsers(db, [task.assigneeId], {
    kind: 'incident',
    severity: inc.severity,
    title: `New task on ${inc.ref}`,
    body: `${task.title} — assigned by ${user.name}.`,
    link: link(inc.ref),
    regionId: inc.regionId,
    incidentId: inc.id,
    isDemo: inc.isDemo,
    createdAt: at,
  });
}

export async function createTask(db: DB, user: Actor, ref: string, input: TaskInput, opts: { at?: Date; notify?: boolean } = {}) {
  const { inc, path } = await loadIncident(db, ref);
  assertCan(user, 'task:update', path);
  assertCan(user, 'incident:update', path);
  const title = input.title.trim();
  if (title.length < 3) throw new DomainError(422, 'Task title is too short');
  await assertTaskAssignee(db, path, input.assigneeId);
  const at = opts.at ?? new Date();
  const status = input.status ?? 'todo';
  const [task] = await db
    .insert(incidentTasks)
    .values({
      incidentId: inc.id,
      title: title.slice(0, 300),
      status,
      priority: input.priority ?? 'p3',
      assigneeId: input.assigneeId ?? null,
      dueAt: input.dueAt ?? null,
      createdBy: user.id,
      createdAt: at,
      completedAt: status === 'done' ? at : null,
    })
    .returning({ id: incidentTasks.id });
  await activity(db, inc.id, user.id, 'task', `Task added: ${title}.`, { taskId: task.id }, at);
  await audit(db, { actor: user, action: 'task.create', entityType: 'incident_task', entityId: task.id, regionId: inc.regionId, after: { incident: ref, title, assigneeId: input.assigneeId ?? null } });
  if (opts.notify !== false) await notifyTaskAssignee(db, user, inc, { title, assigneeId: input.assigneeId ?? null }, at);
  return { id: task.id };
}

export async function updateTask(
  db: DB,
  user: Actor,
  ref: string,
  taskId: string,
  patch: { title?: string; status?: TaskStatus; priority?: Priority; assigneeId?: string | null; dueAt?: Date | null },
  opts: { at?: Date } = {},
) {
  const { inc, path } = await loadIncident(db, ref);
  const [task] = await db.select().from(incidentTasks).where(and(eq(incidentTasks.id, taskId), eq(incidentTasks.incidentId, inc.id))).limit(1);
  if (!task) throw new DomainError(404, 'Task not found');
  assertCan(user, 'task:update', path);
  const manager = can(user.assignments, 'incident:update', path);
  if (!manager) {
    // Field responders: only their own tasks, and only the status.
    if (task.assigneeId !== user.id) throw new DomainError(403, 'You can only update tasks assigned to you');
    const disallowed = (['title', 'priority', 'assigneeId', 'dueAt'] as const).filter((k) => patch[k] !== undefined);
    if (disallowed.length) throw new DomainError(403, 'You can only change the status of your own tasks');
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== task.assigneeId) await assertTaskAssignee(db, path, patch.assigneeId);
  const at = opts.at ?? new Date();
  const set: Partial<typeof incidentTasks.$inferInsert> = {};
  const changes: string[] = [];
  if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== task.title) {
    set.title = patch.title.trim().slice(0, 300);
    changes.push('title');
  }
  if (patch.status && patch.status !== task.status) {
    set.status = patch.status;
    set.completedAt = patch.status === 'done' ? at : null;
    changes.push(`status ${task.status.replace('_', ' ')} → ${patch.status.replace('_', ' ')}`);
  }
  if (patch.priority && patch.priority !== task.priority) {
    set.priority = patch.priority;
    changes.push(`priority ${patch.priority.toUpperCase()}`);
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== task.assigneeId) {
    set.assigneeId = patch.assigneeId;
    changes.push(patch.assigneeId ? 'reassigned' : 'unassigned');
  }
  if (patch.dueAt !== undefined && (patch.dueAt?.getTime() ?? null) !== (task.dueAt?.getTime() ?? null)) {
    set.dueAt = patch.dueAt;
    changes.push(patch.dueAt ? 'due date changed' : 'due date cleared');
  }
  if (!changes.length) return { id: taskId, changed: [] as string[] };
  await db.update(incidentTasks).set(set).where(eq(incidentTasks.id, taskId));
  await db.update(incidents).set({ updatedAt: at }).where(eq(incidents.id, inc.id));
  await activity(db, inc.id, user.id, 'task', `Task “${set.title ?? task.title}”: ${changes.join(', ')}.`, { taskId }, at);
  await audit(db, {
    actor: user,
    action: 'task.update',
    entityType: 'incident_task',
    entityId: taskId,
    regionId: inc.regionId,
    before: { status: task.status, priority: task.priority, assigneeId: task.assigneeId },
    after: set,
  });
  if (set.assigneeId) await notifyTaskAssignee(db, user, inc, { title: set.title ?? task.title, assigneeId: set.assigneeId }, at);
  return { id: taskId, changed: changes };
}

export async function deleteTask(db: DB, user: Actor, ref: string, taskId: string) {
  const { inc, path } = await loadIncident(db, ref);
  assertCan(user, 'task:update', path);
  assertCan(user, 'incident:update', path);
  const [task] = await db.delete(incidentTasks).where(and(eq(incidentTasks.id, taskId), eq(incidentTasks.incidentId, inc.id))).returning();
  if (!task) throw new DomainError(404, 'Task not found');
  await activity(db, inc.id, user.id, 'task', `Task removed: ${task.title}.`, { taskId });
  await audit(db, { actor: user, action: 'task.delete', entityType: 'incident_task', entityId: taskId, regionId: inc.regionId, before: { title: task.title, status: task.status } });
  return { ok: true };
}

// ───────────────────────────── Queries ─────────────────────────────
export type IncidentFilters = {
  status?: IncidentStatus | 'active' | 'all';
  priority?: Priority;
  severity?: Severity;
  region?: string;
  teamId?: number;
  mine?: boolean;
  overdue?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
};

function scopeConds(user: Actor): SQL[] {
  const s = withinScopes(regions.path, scopesFor(user.assignments, 'incident:view'));
  return s ? [s] : [];
}

export async function listIncidents(db: DB, user: Actor, f: IncidentFilters = {}) {
  if (!can(user.assignments, 'incident:view')) return { items: [], total: 0 };
  const conds = scopeConds(user);
  const status = f.status ?? 'active';
  if (status === 'active') conds.push(inArray(incidents.status, ACTIVE_STATUSES));
  else if (status !== 'all') conds.push(eq(incidents.status, status));
  if (f.priority) conds.push(eq(incidents.priority, f.priority));
  if (f.severity) conds.push(eq(incidents.severity, f.severity));
  if (f.teamId) conds.push(eq(incidents.teamId, f.teamId));
  if (f.mine) {
    conds.push(
      or(
        eq(incidents.ownerId, user.id),
        sql`exists (select 1 from incident_tasks t where t.incident_id = "incidents"."id" and t.assignee_id = ${user.id})`,
        sql`exists (select 1 from team_members tm where tm.team_id = "incidents"."team_id" and tm.user_id = ${user.id})`,
      )!,
    );
  }
  if (f.overdue) conds.push(and(lt(incidents.dueAt, new Date()), inArray(incidents.status, ACTIVE_STATUSES))!);
  if (f.region) conds.push(sql`(${regions.code} = ${f.region} or ${regions.path} like ${'%/' + f.region + '/%'} or ${regions.path} like ${'%/' + f.region})`);
  if (f.q?.trim()) {
    const q = `%${f.q.trim().slice(0, 80)}%`;
    conds.push(or(ilike(incidents.title, q), ilike(incidents.ref, q), ilike(incidents.description, q))!);
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = await db
    .select({
      id: incidents.id,
      ref: incidents.ref,
      title: incidents.title,
      status: incidents.status,
      priority: incidents.priority,
      severity: incidents.severity,
      dueAt: incidents.dueAt,
      openedAt: incidents.openedAt,
      updatedAt: incidents.updatedAt,
      regionCode: regions.code,
      regionName: regions.name,
      teamName: teams.name,
      ownerName: users.name,
      alertId: incidents.alertId,
      advisoryId: incidents.advisoryId,
      isDemo: incidents.isDemo,
      openTasks: sql<number>`(select count(*)::int from incident_tasks t where t.incident_id = "incidents"."id" and t.status <> 'done')`,
      totalTasks: sql<number>`(select count(*)::int from incident_tasks t where t.incident_id = "incidents"."id")`,
    })
    .from(incidents)
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .leftJoin(teams, eq(teams.id, incidents.teamId))
    .leftJoin(users, eq(users.id, incidents.ownerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(
      sql`case when ${incidents.status} in ('resolved','closed') then 1 else 0 end`,
      asc(incidents.priority),
      sql`${incidents.dueAt} asc nulls last`,
      desc(incidents.updatedAt),
    )
    .limit(limit)
    .offset(Math.max(f.offset ?? 0, 0));
  const [{ n }] = await db
    .select({ n: count() })
    .from(incidents)
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .where(conds.length ? and(...conds) : undefined);
  const now = Date.now();
  return {
    items: rows.map((r) => ({
      ...r,
      dueAt: r.dueAt?.toISOString() ?? null,
      openedAt: r.openedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      overdue: r.dueAt != null && r.dueAt.getTime() < now && ACTIVE_STATUSES.includes(r.status),
      openTasks: Number(r.openTasks),
      totalTasks: Number(r.totalTasks),
    })),
    total: Number(n),
  };
}
export type IncidentListItem = Awaited<ReturnType<typeof listIncidents>>['items'][number];

export async function getIncident(db: DB, user: Actor, ref: string) {
  const { inc, path, regionName, regionCode } = await loadIncident(db, ref);
  assertCan(user, 'incident:view', path);
  const name = (id: string | null) => (id ? sql<string | null>`(select u.name from users u where u.id = ${id})` : sql<null>`null`);
  const [extra] = await db
    .select({
      teamName: sql<string | null>`(select t.name from teams t where t.id = "incidents"."team_id")`,
      ownerName: name(inc.ownerId),
      openedByName: name(inc.openedBy),
      parentName: sql<string | null>`(select p.name from regions p join regions c on c.parent_id = p.id where c.id = "incidents"."region_id")`,
    })
    .from(incidents)
    .where(eq(incidents.id, inc.id));
  const alert = inc.alertId
    ? ((
        await db
          .select({ id: alerts.id, title: alerts.title, severity: alerts.severity, status: alerts.status, targetDate: alerts.targetDate })
          .from(alerts)
          .where(eq(alerts.id, inc.alertId))
      )[0] ?? null)
    : null;
  const advisory = inc.advisoryId
    ? ((
        await db
          .select({ id: advisories.id, title: advisories.title, severity: advisories.severity, status: advisories.status, audience: advisories.audience })
          .from(advisories)
          .where(eq(advisories.id, inc.advisoryId))
      )[0] ?? null)
    : null;
  const tasks = await db
    .select({
      id: incidentTasks.id,
      title: incidentTasks.title,
      status: incidentTasks.status,
      priority: incidentTasks.priority,
      assigneeId: incidentTasks.assigneeId,
      assigneeName: users.name,
      dueAt: incidentTasks.dueAt,
      createdAt: incidentTasks.createdAt,
      completedAt: incidentTasks.completedAt,
    })
    .from(incidentTasks)
    .leftJoin(users, eq(users.id, incidentTasks.assigneeId))
    .where(eq(incidentTasks.incidentId, inc.id))
    .orderBy(sql`case ${incidentTasks.status} when 'done' then 1 else 0 end`, asc(incidentTasks.priority), sql`${incidentTasks.dueAt} asc nulls last`);
  const activities = await db
    .select({ id: incidentActivities.id, kind: incidentActivities.kind, body: incidentActivities.body, createdAt: incidentActivities.createdAt, actorName: users.name })
    .from(incidentActivities)
    .leftJoin(users, eq(users.id, incidentActivities.actorId))
    .where(eq(incidentActivities.incidentId, inc.id))
    .orderBy(desc(incidentActivities.createdAt), desc(incidentActivities.id));

  const has = (p: Permission) => can(user.assignments, p, path);
  const transitions = INCIDENT_FLOW[inc.status]
    .filter((to) => has(permissionForTransition(inc.status, to)))
    .map((to) => ({ to, label: transitionLabel(inc.status, to), needsSummary: to === 'resolved' || to === 'closed' }));
  const now = Date.now();
  const manager = has('incident:update');
  return {
    id: inc.id,
    ref: inc.ref,
    title: inc.title,
    description: inc.description,
    status: inc.status,
    priority: inc.priority,
    severity: inc.severity,
    dueAt: inc.dueAt?.toISOString() ?? null,
    overdue: inc.dueAt != null && inc.dueAt.getTime() < now && ACTIVE_STATUSES.includes(inc.status),
    openedAt: inc.openedAt.toISOString(),
    updatedAt: inc.updatedAt.toISOString(),
    resolvedAt: inc.resolvedAt?.toISOString() ?? null,
    closedAt: inc.closedAt?.toISOString() ?? null,
    resolutionSummary: inc.resolutionSummary,
    isDemo: inc.isDemo,
    region: { id: inc.regionId, code: regionCode, name: regionName, path, parentName: extra?.parentName ?? null },
    teamId: inc.teamId,
    teamName: extra?.teamName ?? null,
    ownerId: inc.ownerId,
    ownerName: extra?.ownerName ?? null,
    openedByName: extra?.openedByName ?? null,
    alert,
    advisory,
    tasks: tasks.map((t) => ({
      ...t,
      dueAt: t.dueAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      completedAt: t.completedAt?.toISOString() ?? null,
      overdue: t.dueAt != null && t.dueAt.getTime() < now && t.status !== 'done',
      canEdit: has('task:update') && (manager || t.assigneeId === user.id),
      statusOnly: !manager,
    })),
    activities: activities.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    permissions: {
      update: manager,
      assign: has('incident:assign'),
      close: has('incident:close'),
      manageTasks: manager && has('task:update'),
      note: manager || (has('task:update') && tasks.some((t) => t.assigneeId === user.id)),
    },
    transitions,
  };
}
export type IncidentDetail = Awaited<ReturnType<typeof getIncident>>;

/** Options for assignment pickers (teams covering the region, eligible owners and task assignees). */
export async function assignmentOptions(db: DB, regionPath: string) {
  const [teamsList, owners, assignees] = await Promise.all([
    eligibleTeams(db, regionPath),
    eligibleUsers(db, 'incident:update', regionPath),
    eligibleUsers(db, 'task:update', regionPath),
  ]);
  return { teams: teamsList.map((t) => ({ id: t.id, name: t.name, regionName: t.regionName })), owners, assignees };
}

// ───────────────────────────── Dashboard ─────────────────────────────
export async function dashboard(db: DB, user: Actor) {
  const scope = scopeConds(user);
  const base = scope.length ? and(...scope) : undefined;
  const now = new Date();

  const statusRows = await db
    .select({ status: incidents.status, n: count() })
    .from(incidents)
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .where(base)
    .groupBy(incidents.status);
  const byStatus: Record<IncidentStatus, number> = { reported: 0, triaged: 0, in_progress: 0, monitoring: 0, resolved: 0, closed: 0 };
  for (const r of statusRows) byStatus[r.status] = Number(r.n);

  const activeWhere = and(...scope, inArray(incidents.status, ACTIVE_STATUSES));
  const priorityRows = await db
    .select({ priority: incidents.priority, n: count() })
    .from(incidents)
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .where(activeWhere)
    .groupBy(incidents.priority);
  const byPriority: Record<Priority, number> = { p1: 0, p2: 0, p3: 0, p4: 0 };
  for (const r of priorityRows) byPriority[r.priority] = Number(r.n);

  const stateCode = sql<string>`split_part(${regions.path}, '/', 2)`;
  const regionRows = await db
    .select({
      code: stateCode,
      active: sql<number>`count(*) filter (where ${incidents.status} in ('reported','triaged','in_progress','monitoring'))::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(incidents)
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .where(base)
    .groupBy(stateCode);
  const stateNames = regionRows.length
    ? await db.select({ code: regions.code, name: regions.name }).from(regions).where(inArray(regions.code, regionRows.map((r) => r.code).filter(Boolean)))
    : [];
  const byRegion = regionRows
    .map((r) => ({ code: r.code, name: stateNames.find((s) => s.code === r.code)?.name ?? r.code, active: Number(r.active), total: Number(r.total) }))
    .sort((a, b) => b.active - a.active || b.total - a.total);

  const taskBase = and(...scope, ne(incidentTasks.status, 'done'));
  const [taskTotals] = await db
    .select({
      open: count(),
      overdue: sql<number>`count(*) filter (where ${incidentTasks.dueAt} < now())::int`,
      blocked: sql<number>`count(*) filter (where ${incidentTasks.status} = 'blocked')::int`,
      unassigned: sql<number>`count(*) filter (where ${incidentTasks.assigneeId} is null)::int`,
    })
    .from(incidentTasks)
    .innerJoin(incidents, eq(incidents.id, incidentTasks.incidentId))
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .where(taskBase);

  const teamRows = await db
    .select({
      id: teams.id,
      name: teams.name,
      regionName: sql<string>`(select r.name from regions r where r.id = "teams"."region_id")`,
      teamPath: sql<string>`(select r.path from regions r where r.id = "teams"."region_id")`,
      activeIncidents: sql<number>`(select count(*)::int from incidents i where i.team_id = "teams"."id" and i.status in ('reported','triaged','in_progress','monitoring'))`,
      openTasks: sql<number>`(select count(*)::int from incident_tasks t join team_members tm on tm.user_id = t.assignee_id where tm.team_id = "teams"."id" and t.status <> 'done')`,
      overdueTasks: sql<number>`(select count(*)::int from incident_tasks t join team_members tm on tm.user_id = t.assignee_id where tm.team_id = "teams"."id" and t.status <> 'done' and t.due_at < now())`,
    })
    .from(teams)
    .orderBy(asc(teams.name));
  const viewScopes = scopesFor(user.assignments, 'incident:view');
  const teamWorkload = teamRows
    .filter((t) => viewScopes.some((s) => s === null || pathWithin(t.teamPath, s) || pathWithin(s, t.teamPath)))
    .map((t) => ({ id: t.id, name: t.name, regionName: t.regionName, activeIncidents: Number(t.activeIncidents), openTasks: Number(t.openTasks), overdueTasks: Number(t.overdueTasks) }))
    .sort((a, b) => b.activeIncidents + b.openTasks - (a.activeIncidents + a.openTasks));

  const overdueIncidents = await db
    .select({ ref: incidents.ref, title: incidents.title, priority: incidents.priority, dueAt: incidents.dueAt, regionName: regions.name, status: incidents.status })
    .from(incidents)
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .where(and(...scope, inArray(incidents.status, ACTIVE_STATUSES), lt(incidents.dueAt, now)))
    .orderBy(asc(incidents.dueAt))
    .limit(8);
  const overdueTasks = await db
    .select({ id: incidentTasks.id, title: incidentTasks.title, dueAt: incidentTasks.dueAt, priority: incidentTasks.priority, ref: incidents.ref, assigneeName: users.name })
    .from(incidentTasks)
    .innerJoin(incidents, eq(incidents.id, incidentTasks.incidentId))
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .leftJoin(users, eq(users.id, incidentTasks.assigneeId))
    .where(and(...scope, ne(incidentTasks.status, 'done'), lt(incidentTasks.dueAt, now)))
    .orderBy(asc(incidentTasks.dueAt))
    .limit(8);
  const highPriority = await db
    .select({ ref: incidents.ref, title: incidents.title, priority: incidents.priority, severity: incidents.severity, status: incidents.status, regionName: regions.name, dueAt: incidents.dueAt })
    .from(incidents)
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .where(and(...scope, inArray(incidents.status, ACTIVE_STATUSES), inArray(incidents.priority, ['p1', 'p2'])))
    .orderBy(asc(incidents.priority), sql`${incidents.dueAt} asc nulls last`)
    .limit(8);
  const recent = await db
    .select({
      id: incidentActivities.id,
      kind: incidentActivities.kind,
      body: incidentActivities.body,
      createdAt: incidentActivities.createdAt,
      actorName: users.name,
      ref: incidents.ref,
      title: incidents.title,
    })
    .from(incidentActivities)
    .innerJoin(incidents, eq(incidents.id, incidentActivities.incidentId))
    .innerJoin(regions, eq(regions.id, incidents.regionId))
    .leftJoin(users, eq(users.id, incidentActivities.actorId))
    .where(base)
    .orderBy(desc(incidentActivities.createdAt), desc(incidentActivities.id))
    .limit(12);
  const [myTasks] = await db
    .select({ n: count() })
    .from(incidentTasks)
    .where(and(eq(incidentTasks.assigneeId, user.id), ne(incidentTasks.status, 'done')));

  const active = ACTIVE_STATUSES.reduce((n, s) => n + byStatus[s], 0);
  return {
    totals: {
      active,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      highPriorityActive: byPriority.p1 + byPriority.p2,
      overdueIncidents: overdueIncidents.length,
      openTasks: Number(taskTotals?.open ?? 0),
      overdueTasks: Number(taskTotals?.overdue ?? 0),
      blockedTasks: Number(taskTotals?.blocked ?? 0),
      unassignedTasks: Number(taskTotals?.unassigned ?? 0),
      myOpenTasks: Number(myTasks?.n ?? 0),
    },
    byStatus,
    byPriority,
    byRegion,
    teamWorkload,
    overdueIncidents: overdueIncidents.map((o) => ({ ...o, dueAt: o.dueAt?.toISOString() ?? null })),
    overdueTasks: overdueTasks.map((o) => ({ ...o, dueAt: o.dueAt?.toISOString() ?? null })),
    highPriority: highPriority.map((o) => ({ ...o, dueAt: o.dueAt?.toISOString() ?? null })),
    recentActivity: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}
export type CrmDashboard = Awaited<ReturnType<typeof dashboard>>;


/** Teams related to the user's incident:view scopes (for filters). */
export async function teamsInScope(db: DB, user: Actor) {
  const rows = await db
    .select({ id: teams.id, name: teams.name, path: regions.path })
    .from(teams)
    .innerJoin(regions, eq(regions.id, teams.regionId))
    .orderBy(asc(teams.name));
  const scopes = scopesFor(user.assignments, 'incident:view');
  return rows.filter((t) => scopes.some((s) => s === null || pathWithin(t.path, s) || pathWithin(s, t.path))).map((t) => ({ id: t.id, name: t.name }));
}
