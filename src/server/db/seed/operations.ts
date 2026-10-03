/**
 * Demo seed step `operations`: advisories, alerts, notifications, incidents, tasks and activity.
 *
 * Everything here is FICTIONAL demo content (`is_demo = true`) built on top of the historical replay run
 * (late-May 2024, ERA5 + CLIMATIQ hindcast). Advisories are written by the deterministic TemplateProvider from real
 * replay forecasts; alerts come from the real alert engine. Incident narratives are invented and say so.
 * Idempotent within the step: each part is skipped when its demo records already exist.
 */
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../types';
import { advisories, alerts, incidents, regions, teams, users } from '../schema';
import { latestRun } from '../../forecasting/queries';
import { evaluateAlerts } from '../../alerts/engine';
import { acknowledgeAlert, resolveAlert } from '../../alerts/service';
import { generateAdvisory, transitionAdvisory } from '../../advisories/service';
import { TemplateProvider } from '../../advisories/providers/template';
import { addNote, assignIncident, createIncident, createTask, transitionIncident, updateTask } from '../../incidents/service';
import { loadUser, type AppUser } from '../../auth/users';
import { DEMO_USERS } from './people';
import type { AudienceKey } from '../../advisories/schema';
import type { Priority, Severity } from '@/lib/domain';

const DEMO_NOTE = 'Demo scenario (fictional) based on May 2024 replay.';
const H = 3600_000;

type Users = Record<string, AppUser>;

async function demoUsers(db: DB): Promise<Users | null> {
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, DEMO_USERS.map((u) => u.email)));
  const out: Users = {};
  for (const def of DEMO_USERS) {
    const row = rows.find((r) => r.email.toLowerCase() === def.email.toLowerCase());
    if (!row) return null;
    const u = await loadUser(db, row.id);
    if (!u) return null;
    out[def.key] = u;
  }
  return out;
}

type AdvisorySpec = { regions: string[]; audience: AudienceKey; by: string; final: 'draft' | 'approved' | 'published'; approver?: string; ageH: number };

const ADVISORIES: AdvisorySpec[] = [
  { regions: ['IN-RJ-CHURU', 'IN-RJ-GANGANAGAR'], audience: 'public', by: 'analyst', final: 'published', approver: 'rj_admin', ageH: 30 },
  { regions: ['IN-RJ-CHURU', 'IN-RJ-GANGANAGAR'], audience: 'field_team', by: 'analyst', final: 'approved', approver: 'rj_admin', ageH: 29 },
  { regions: ['IN-RJ'], audience: 'government', by: 'analyst', final: 'published', approver: 'rj_admin', ageH: 28 },
  { regions: ['IN-RJ'], audience: 'disaster_mgmt', by: 'analyst', final: 'draft', ageH: 6 },
  { regions: ['IN-RJ-JAIPUR'], audience: 'field_team', by: 'jaipur_admin', final: 'draft', ageH: 4 },
  { regions: ['IN-UP-BANDA', 'IN-UP-ALLAHABAD'], audience: 'disaster_mgmt', by: 'analyst', final: 'published', approver: 'up_official', ageH: 26 },
  { regions: ['IN-UP-BANDA', 'IN-UP-ALLAHABAD'], audience: 'public', by: 'analyst', final: 'approved', approver: 'up_official', ageH: 25 },
  { regions: ['IN-DL'], audience: 'public', by: 'analyst', final: 'published', approver: 'admin', ageH: 22 },
  { regions: ['IN-DL'], audience: 'government', by: 'analyst', final: 'draft', ageH: 3 },
];

type TaskSpec = { title: string; assignee?: string; priority: Priority; dueInH?: number; status?: 'todo' | 'in_progress' | 'blocked' | 'done'; by: string };
type IncidentSpec = {
  region: string;
  title: string;
  description: string;
  severity: Severity;
  priority: Priority;
  reportedBy: string;
  ageH: number;
  assign?: { by: string; team?: string; owner?: string };
  path: { to: 'triaged' | 'in_progress' | 'monitoring' | 'resolved' | 'closed'; by: string; summary?: string }[];
  dueInH?: number;
  tasks: TaskSpec[];
  notes?: { by: string; body: string }[];
  linkAlert?: boolean;
  advisoryOf?: number; // index in ADVISORIES
};

const INCIDENTS: IncidentSpec[] = [
  {
    region: 'IN-RJ-CHURU',
    title: 'Rising heat-illness presentations at Churu district hospital',
    description: `${DEMO_NOTE} Hospital duty staff report more patients with heat exhaustion than usual during the replayed extreme-heat days. The response cell coordinates cooling points, ORS supply and case reporting.`,
    severity: 'extreme',
    priority: 'p1',
    reportedBy: 'rj_response',
    ageH: 50,
    assign: { by: 'rj_admin', team: 'Rajasthan State Heat Response Cell', owner: 'rj_response' },
    path: [
      { to: 'triaged', by: 'rj_admin' },
      { to: 'in_progress', by: 'rj_response' },
    ],
    dueInH: 20,
    tasks: [
      { title: 'Set up shaded ORS and drinking-water points at the bus stand and main market', assignee: 'rj_response', priority: 'p1', dueInH: 6, status: 'in_progress', by: 'rj_admin' },
      { title: 'Compile daily line-list of suspected heat-illness cases with the district hospital', assignee: 'rj_admin', priority: 'p2', dueInH: 18, by: 'rj_admin' },
      { title: 'Confirm cooled observation beds and ice-pack stock in the emergency ward', assignee: 'rj_response', priority: 'p1', dueInH: -2, status: 'done', by: 'rj_admin' },
    ],
    notes: [{ by: 'rj_response', body: 'Two cooling points operational since morning; third awaiting water tanker (fictional demo note).' }],
    linkAlert: true,
    advisoryOf: 1,
  },
  {
    region: 'IN-RJ-JAIPUR',
    title: 'Drinking-water and shade gaps at Jaipur construction sites',
    description: `${DEMO_NOTE} Field checks requested after the CLIMATIQ alert for Jaipur to verify that worksites provide shade, water and rest breaks during the hottest hours.`,
    severity: 'high',
    priority: 'p2',
    reportedBy: 'jaipur_admin',
    ageH: 30,
    assign: { by: 'jaipur_admin', team: 'Jaipur District Response Team', owner: 'jaipur_admin' },
    path: [{ to: 'triaged', by: 'jaipur_admin' }],
    dueInH: 40,
    tasks: [
      { title: 'Inspect shade and drinking water at five large construction sites', assignee: 'jaipur_field', priority: 'p2', dueInH: 10, status: 'in_progress', by: 'jaipur_admin' },
      { title: 'Distribute ORS sachets to site supervisors along the ring-road worksites', assignee: 'jaipur_field', priority: 'p3', dueInH: 30, by: 'jaipur_admin' },
      { title: 'Share heat-safety poster set with the labour department', assignee: 'jaipur_admin', priority: 'p4', dueInH: 48, by: 'jaipur_admin' },
    ],
    linkAlert: true,
  },
  {
    region: 'IN-RJ-GANGANAGAR',
    title: 'Livestock heat-stress reports from villages in Ganganagar',
    description: `${DEMO_NOTE} Panchayat volunteers report distressed cattle and shortage of water troughs. Awaiting triage by the state heat response cell.`,
    severity: 'extreme',
    priority: 'p3',
    reportedBy: 'rj_response',
    ageH: 8,
    path: [],
    dueInH: 36,
    tasks: [],
    linkAlert: true,
  },
  {
    region: 'IN-UP-BANDA',
    title: 'Power cuts affecting cooling at Banda district hospital',
    description: `${DEMO_NOTE} Intermittent outages reduce cooling in the heatstroke ward during peak afternoon hours. Generator backup confirmed; utility coordination pending.`,
    severity: 'high',
    priority: 'p1',
    reportedBy: 'up_official',
    ageH: 70,
    assign: { by: 'up_official', team: 'Uttar Pradesh Heat Response Cell', owner: 'up_official' },
    path: [
      { to: 'triaged', by: 'up_official' },
      { to: 'in_progress', by: 'up_official' },
      { to: 'monitoring', by: 'up_official' },
    ],
    dueInH: -20, // overdue on purpose
    tasks: [
      { title: 'Confirm generator backup and fuel for the heatstroke ward', assignee: 'up_official', priority: 'p1', dueInH: -40, status: 'done', by: 'up_official' },
      { title: 'Agree a load-shedding exemption schedule with the power utility', assignee: 'up_official', priority: 'p1', dueInH: -6, status: 'blocked', by: 'up_official' },
    ],
    notes: [{ by: 'up_official', body: 'Utility has not yet confirmed the exemption schedule; escalated to the district collector (fictional demo note).' }],
    linkAlert: true,
    advisoryOf: 5,
  },
  {
    region: 'IN-UP-ALLAHABAD',
    title: 'Heat exposure at riverside gathering sites in Prayagraj',
    description: `${DEMO_NOTE} Large daytime gatherings at riverside sites during the replayed heat spell; temporary shade and water points requested.`,
    severity: 'extreme',
    priority: 'p2',
    reportedBy: 'up_official',
    ageH: 90,
    assign: { by: 'up_official', team: 'Uttar Pradesh Heat Response Cell', owner: 'up_official' },
    path: [
      { to: 'triaged', by: 'up_official' },
      { to: 'in_progress', by: 'up_official' },
      {
        to: 'resolved',
        by: 'up_official',
        summary: 'Shade structures and water points were set up at three gathering sites and no further heat-illness cases were reported over 48 hours (fictional demo outcome).',
      },
    ],
    tasks: [
      { title: 'Install temporary shade and drinking-water points at three sites', assignee: 'up_official', priority: 'p2', dueInH: -60, status: 'done', by: 'up_official' },
      { title: 'Announce afternoon heat-safety messages over the public address system', assignee: 'up_official', priority: 'p3', dueInH: -50, status: 'done', by: 'up_official' },
    ],
    linkAlert: true,
  },
  {
    region: 'IN-DL-CENTRAL',
    title: 'Night-shelter capacity for homeless people during the heat spell, Central Delhi',
    description: `${DEMO_NOTE} Shelters were asked to stay open during the day with fans, water and ORS for people sleeping rough.`,
    severity: 'extreme',
    priority: 'p2',
    reportedBy: 'admin',
    ageH: 120,
    assign: { by: 'admin', owner: 'admin' },
    path: [
      { to: 'triaged', by: 'admin' },
      { to: 'in_progress', by: 'admin' },
      { to: 'resolved', by: 'admin', summary: 'Day-time shelter access with water and ORS was arranged for the duration of the spell (fictional demo outcome).' },
      { to: 'closed', by: 'admin' },
    ],
    tasks: [{ title: 'Confirm day-time opening hours with shelter operators', assignee: 'admin', priority: 'p2', dueInH: -100, status: 'done', by: 'admin' }],
    linkAlert: true,
    advisoryOf: 7,
  },
  {
    region: 'IN-MH-NAGPUR',
    title: 'Outdoor-labour heat-safety compliance checks, Nagpur',
    description: `${DEMO_NOTE} Spot checks that employers reschedule heavy outdoor work away from the afternoon peak while temperatures stay above normal.`,
    severity: 'moderate',
    priority: 'p3',
    reportedBy: 'mh_official',
    ageH: 40,
    assign: { by: 'mh_official', team: 'Maharashtra EOC Heat Desk', owner: 'mh_official' },
    path: [
      { to: 'triaged', by: 'mh_official' },
      { to: 'in_progress', by: 'mh_official' },
    ],
    dueInH: 60,
    tasks: [{ title: 'Compile list of large outdoor worksites for spot checks', assignee: 'mh_official', priority: 'p3', dueInH: 24, status: 'in_progress', by: 'mh_official' }],
    linkAlert: true,
  },
  {
    region: 'IN-OR-BALANGIR',
    title: 'Heat-illness preparedness at primary health centres, Balangir',
    description: `${DEMO_NOTE} PHCs asked to confirm ORS stock and cooling arrangements ahead of the forecast hot days.`,
    severity: 'high',
    priority: 'p4',
    reportedBy: 'or_response',
    ageH: 20,
    path: [{ to: 'triaged', by: 'or_response' }],
    dueInH: 72,
    tasks: [],
    linkAlert: true,
  },
];

async function replayAlertFor(db: DB, regionCode: string) {
  const [a] = await db
    .select({ id: alerts.id, status: alerts.status })
    .from(alerts)
    .innerJoin(regions, eq(regions.id, alerts.regionId))
    .where(and(eq(regions.code, regionCode), sql`${alerts.dedupKey} like 'replay:%'`))
    .orderBy(desc(alerts.createdAt))
    .limit(1);
  return a ?? null;
}

export async function seedOperations(db: DB, log: (m: string) => void = () => {}) {
  const u = await demoUsers(db);
  if (!u) return { skipped: 'demo users missing' };
  const now = Date.now();
  const detail: Record<string, unknown> = {};

  const replay = await latestRun(db, 'replay');
  const advisoryIds: (string | null)[] = ADVISORIES.map(() => null);

  if (replay) {
    // ── Advisories (deterministic template, real replay forecasts) ──
    const [{ n: existingAdv }] = await db.select({ n: count() }).from(advisories).where(eq(advisories.isDemo, true));
    if (Number(existingAdv) === 0) {
      const template = new TemplateProvider();
      for (const [i, s] of ADVISORIES.entries()) {
        try {
          const at = new Date(now - s.ageH * H);
          const { id } = await generateAdvisory(
            db,
            u[s.by],
            { runId: replay.id, regionCodes: s.regions, audience: s.audience },
            { provider: template, isDemo: true, notify: s.final === 'draft', at },
          );
          advisoryIds[i] = id;
          if (s.final !== 'draft' && s.approver) {
            await transitionAdvisory(db, u[s.approver], id, 'approve', { at: new Date(at.getTime() + 2 * H) });
            if (s.final === 'published') await transitionAdvisory(db, u[s.approver], id, 'publish', { at: new Date(at.getTime() + 3 * H), notify: false });
          }
        } catch (e) {
          log(`  advisory ${s.regions.join('+')} (${s.audience}) skipped: ${(e as Error).message}`);
        }
      }
      detail.advisories = advisoryIds.filter(Boolean).length;
    }

    // ── Alerts from the real rule engine ──
    const res = await evaluateAlerts(db, replay.id, { isDemo: true });
    detail.alerts = res;
    log(`  replay alerts: ${res.created} created, ${res.skipped} skipped, ${res.notified} notifications`);
  } else {
    detail.replay = 'no replay run — incidents seeded without alert/advisory links';
  }

  // ── Incidents ──
  const [{ n: existingInc }] = await db.select({ n: count() }).from(incidents).where(eq(incidents.isDemo, true));
  if (Number(existingInc) > 0) return { ...detail, incidents: 'already seeded' };

  const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams);
  const teamId = (name?: string) => (name ? (teamRows.find((t) => t.name === name)?.id ?? null) : null);
  let created = 0;
  for (const spec of INCIDENTS) {
    try {
      let t = now - spec.ageH * H;
      const tick = (h = 0.7) => new Date((t += h * H));
      const alert = replay && spec.linkAlert ? await replayAlertFor(db, spec.region) : null;
      const advisoryId = spec.advisoryOf != null ? advisoryIds[spec.advisoryOf] : null;
      const inc = await createIncident(
        db,
        u[spec.reportedBy],
        {
          title: spec.title,
          description: spec.description,
          regionCode: spec.region,
          severity: spec.severity,
          priority: spec.priority,
          alertId: alert?.id ?? null,
          advisoryId,
          dueAt: spec.dueInH != null ? new Date(now + spec.dueInH * H) : null,
        },
        { isDemo: true, at: new Date(t) },
      );
      created++;
      if (spec.assign) {
        await assignIncident(db, u[spec.assign.by], inc.ref, { teamId: teamId(spec.assign.team), ownerId: spec.assign.owner ? u[spec.assign.owner].id : null }, { at: tick(), isDemo: true });
      }
      for (const [i, step] of spec.path.entries()) {
        await transitionIncident(db, u[step.by], inc.ref, step.to, { resolutionSummary: step.summary ?? null, at: tick(i === 0 ? 0.5 : 3) });
        if (i === 0) {
          for (const task of spec.tasks) {
            const { id } = await createTask(
              db,
              u[task.by],
              inc.ref,
              { title: task.title, priority: task.priority, assigneeId: task.assignee ? u[task.assignee].id : null, dueAt: task.dueInH != null ? new Date(now + task.dueInH * H) : null },
              { at: tick(0.2) },
            );
            if (task.status && task.status !== 'todo') {
              const actor = task.assignee ? u[task.assignee] : u[task.by];
              await updateTask(db, actor, inc.ref, id, { status: task.status }, { at: tick(0.5) });
            }
          }
        }
      }
      for (const note of spec.notes ?? []) await addNote(db, u[note.by], inc.ref, note.body, { at: tick(0.3) });

      // Alert follow-up mirrors the incident state.
      if (alert && alert.status === 'active') {
        const resolved = spec.path.some((p) => p.to === 'resolved');
        const actor = u[spec.assign?.by ?? spec.reportedBy];
        try {
          if (resolved) await resolveAlert(db, actor, alert.id, 'Handled through response incident (demo).');
          else if (spec.assign) await acknowledgeAlert(db, actor, alert.id);
        } catch (e) {
          log(`  alert follow-up for ${spec.region} skipped: ${(e as Error).message}`);
        }
      }
      if (alert && advisoryId) await db.update(alerts).set({ advisoryId }).where(eq(alerts.id, alert.id));
    } catch (e) {
      log(`  incident "${spec.title}" skipped: ${(e as Error).message}`);
    }
  }
  detail.incidents = created;
  log(`  ${created} fictional demo incidents`);
  return detail;
}
