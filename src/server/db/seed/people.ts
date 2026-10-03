/** Fictional demo users, role assignments and response teams. All names are invented; emails use the .demo TLD. */
import { eq, inArray } from 'drizzle-orm';
import type { DB } from '../types';
import { regions, roles, teamMembers, teams, userRoles, users } from '../schema';
import { hashPassword } from '../../auth/password';
import type { RoleKey } from '@/lib/rbac';

export const DEMO_PASSWORD = 'climatiq-demo';

export type DemoUserDef = {
  key: string;
  name: string;
  email: string;
  designation: string;
  role: RoleKey;
  region: string | null; // region code; null = nationwide
};

export const DEMO_USERS: DemoUserDef[] = [
  { key: 'admin', name: 'Aarav Mehta', email: 'aarav.mehta@climatiq.demo', designation: 'Platform administrator (fictional)', role: 'system_admin', region: null },
  { key: 'analyst', name: 'Dr. Ishita Banerjee', email: 'ishita.banerjee@climatiq.demo', designation: 'Senior climate analyst (fictional)', role: 'climate_analyst', region: null },
  { key: 'rj_admin', name: 'Kavya Rathore', email: 'kavya.rathore@climatiq.demo', designation: 'State heat-action nodal officer, Rajasthan (fictional)', role: 'state_admin', region: 'IN-RJ' },
  { key: 'jaipur_admin', name: 'Dev Malhotra', email: 'dev.malhotra@climatiq.demo', designation: 'District disaster management officer, Jaipur (fictional)', role: 'district_admin', region: 'IN-RJ-JAIPUR' },
  { key: 'mh_official', name: 'Rohan Kulkarni', email: 'rohan.kulkarni@climatiq.demo', designation: 'EOC duty officer, Maharashtra (fictional)', role: 'disaster_official', region: 'IN-MH' },
  { key: 'up_official', name: 'Sanjay Verma', email: 'sanjay.verma@climatiq.demo', designation: 'Relief commissioner’s office, Uttar Pradesh (fictional)', role: 'disaster_official', region: 'IN-UP' },
  { key: 'rj_response', name: 'Arjun Singh', email: 'arjun.singh@climatiq.demo', designation: 'Heat response cell coordinator, Rajasthan (fictional)', role: 'response_team', region: 'IN-RJ' },
  { key: 'or_response', name: 'Meera Pillai', email: 'meera.pillai@climatiq.demo', designation: 'Coastal response team lead, Odisha (fictional)', role: 'response_team', region: 'IN-OR' },
  { key: 'jaipur_field', name: 'Priya Sharma', email: 'priya.sharma@climatiq.demo', designation: 'Field unit lead, Jaipur (fictional)', role: 'field_responder', region: 'IN-RJ-JAIPUR' },
  { key: 'public', name: 'Neha Gupta', email: 'neha.gupta@climatiq.demo', designation: 'Member of the public (fictional)', role: 'public', region: null },
];

export const DEMO_TEAMS: { name: string; kind: 'state_eoc' | 'district_response' | 'field_unit' | 'health' | 'analysis'; region: string; members: { user: string; lead?: boolean }[] }[] = [
  { name: 'National Climate Analysis Desk', kind: 'analysis', region: 'IN', members: [{ user: 'analyst', lead: true }] },
  { name: 'Rajasthan State Heat Response Cell', kind: 'state_eoc', region: 'IN-RJ', members: [{ user: 'rj_admin', lead: true }, { user: 'rj_response' }] },
  { name: 'Jaipur District Response Team', kind: 'district_response', region: 'IN-RJ-JAIPUR', members: [{ user: 'jaipur_admin', lead: true }, { user: 'jaipur_field' }] },
  { name: 'Jaipur Field Unit 1', kind: 'field_unit', region: 'IN-RJ-JAIPUR', members: [{ user: 'jaipur_field', lead: true }] },
  { name: 'Maharashtra EOC Heat Desk', kind: 'state_eoc', region: 'IN-MH', members: [{ user: 'mh_official', lead: true }] },
  { name: 'Uttar Pradesh Heat Response Cell', kind: 'state_eoc', region: 'IN-UP', members: [{ user: 'up_official', lead: true }] },
  { name: 'Odisha Coastal Response Team', kind: 'district_response', region: 'IN-OR', members: [{ user: 'or_response', lead: true }] },
];

export async function seedPeople(db: DB) {
  const hash = await hashPassword(DEMO_PASSWORD);
  const roleRows = await db.select().from(roles);
  const roleId = new Map(roleRows.map((r) => [r.key, r.id]));
  const codes = [...new Set([...DEMO_USERS.map((u) => u.region), ...DEMO_TEAMS.map((t) => t.region)].filter((c): c is string => c != null))];
  const regionRows = await db.select({ id: regions.id, code: regions.code }).from(regions).where(inArray(regions.code, codes));
  const regionId = new Map(regionRows.map((r) => [r.code, r.id]));

  const userId = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email)).limit(1);
    const id =
      existing[0]?.id ??
      (await db.insert(users).values({ email: u.email, name: u.name, designation: u.designation, passwordHash: hash, isDemo: true }).returning({ id: users.id }))[0].id;
    userId.set(u.key, id);
    await db
      .insert(userRoles)
      .values({ userId: id, roleId: roleId.get(u.role)!, regionId: u.region ? regionId.get(u.region)! : null })
      .onConflictDoNothing();
  }

  for (const t of DEMO_TEAMS) {
    const [team] = await db.insert(teams).values({ name: t.name, kind: t.kind, regionId: regionId.get(t.region)!, isDemo: true }).returning({ id: teams.id });
    for (const m of t.members) {
      await db.insert(teamMembers).values({ teamId: team.id, userId: userId.get(m.user)!, isLead: m.lead ?? false }).onConflictDoNothing();
    }
  }
  return { users: DEMO_USERS.length, teams: DEMO_TEAMS.length };
}
