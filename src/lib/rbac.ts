/**
 * Role & permission catalogue. Shared by server (enforcement) and client (cosmetic gating only).
 * The database tables `roles`, `permissions`, `role_permissions` are seeded from these constants.
 */

export const PERMISSIONS = {
  'dashboard:view': 'View the command center, forecasts and station dashboards',
  'forecast:run': 'Trigger a new forecast run',
  'analytics:view': 'View climate analytics and forecast accuracy',
  'analytics:export': 'Export analytics and forecast data as CSV',
  'advisory:view_internal': 'View internal (non-public) advisories',
  'advisory:generate': 'Generate AI-assisted advisory drafts',
  'advisory:approve': 'Approve and publish advisories',
  'alert:view': 'View CLIMATIQ alerts',
  'alert:acknowledge': 'Acknowledge alerts',
  'alert:manage': 'Resolve alerts and run alert rules',
  'incident:view': 'View response incidents',
  'incident:create': 'Create response incidents',
  'incident:update': 'Update incidents (status, notes)',
  'incident:assign': 'Assign incidents to teams and officials',
  'incident:close': 'Resolve and close incidents',
  'task:update': 'Create and update response tasks',
  'station:view': 'View weather stations',
  'station:manage': 'Register stations and manage station API keys',
  'ingestion:run': 'Trigger data ingestion runs',
  'data:correct': 'Correct climate records (audited)',
  'admin:view': 'Open the administration panel',
  'admin:users': 'Manage users, roles and geographic assignments',
  'audit:view': 'View audit logs',
  'config:edit': 'Edit thresholds and system configuration',
  'demo:reset': 'Reset demo data to the seed state',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export type RoleKey =
  | 'system_admin'
  | 'state_admin'
  | 'district_admin'
  | 'climate_analyst'
  | 'disaster_official'
  | 'response_team'
  | 'field_responder'
  | 'public';

const ALL = Object.keys(PERMISSIONS) as Permission[];
const VIEW: Permission[] = ['dashboard:view', 'station:view', 'alert:view', 'advisory:view_internal'];

export const ROLES: Record<RoleKey, { name: string; description: string; rank: number; permissions: Permission[] }> = {
  system_admin: {
    name: 'System administrator',
    description: 'Full platform administration, nationwide.',
    rank: 1,
    permissions: ALL,
  },
  state_admin: {
    name: 'State administrator',
    description: 'Administers users, advisories and response within a state.',
    rank: 2,
    permissions: [
      ...VIEW,
      'forecast:run',
      'analytics:view',
      'analytics:export',
      'advisory:generate',
      'advisory:approve',
      'alert:acknowledge',
      'alert:manage',
      'incident:view',
      'incident:create',
      'incident:update',
      'incident:assign',
      'incident:close',
      'task:update',
      'station:manage',
      'ingestion:run',
      'admin:view',
      'admin:users',
      'audit:view',
    ],
  },
  district_admin: {
    name: 'District administrator',
    description: 'Coordinates advisories and response within a district.',
    rank: 3,
    permissions: [
      ...VIEW,
      'analytics:view',
      'advisory:generate',
      'advisory:approve',
      'alert:acknowledge',
      'alert:manage',
      'incident:view',
      'incident:create',
      'incident:update',
      'incident:assign',
      'incident:close',
      'task:update',
    ],
  },
  climate_analyst: {
    name: 'Climate analyst',
    description: 'Runs forecasts, analyses data and drafts advisories.',
    rank: 4,
    permissions: [
      ...VIEW,
      'forecast:run',
      'analytics:view',
      'analytics:export',
      'advisory:generate',
      'ingestion:run',
      'data:correct',
      'incident:view',
    ],
  },
  disaster_official: {
    name: 'Disaster-management official',
    description: 'Approves advisories, manages alerts and directs response.',
    rank: 5,
    permissions: [
      ...VIEW,
      'analytics:view',
      'advisory:generate',
      'advisory:approve',
      'alert:acknowledge',
      'alert:manage',
      'incident:view',
      'incident:create',
      'incident:update',
      'incident:assign',
      'incident:close',
      'task:update',
    ],
  },
  response_team: {
    name: 'Regional response team',
    description: 'Handles incidents and tasks for an assigned region.',
    rank: 6,
    permissions: [...VIEW, 'alert:acknowledge', 'incident:view', 'incident:create', 'incident:update', 'task:update'],
  },
  field_responder: {
    name: 'Field response team',
    description: 'Updates assigned field tasks.',
    rank: 7,
    permissions: [...VIEW, 'incident:view', 'task:update'],
  },
  public: {
    name: 'Public user',
    description: 'Public climate information only.',
    rank: 8,
    permissions: [],
  },
};

/** A role assignment bound to a geographic scope (null path = nationwide). */
export type Assignment = {
  roleKey: RoleKey;
  regionId: number | null;
  regionCode: string | null;
  regionName: string | null;
  regionPath: string | null;
  permissions: Permission[];
};

/** True when `targetPath` equals or descends from `scopePath`. Paths look like 'IN/IN-RJ/IN-RJ-JAIPUR'. */
export function pathWithin(targetPath: string, scopePath: string | null): boolean {
  if (scopePath === null) return true;
  return targetPath === scopePath || targetPath.startsWith(`${scopePath}/`);
}

/**
 * Permission check with geographic scope.
 * - Without `regionPath`: true if ANY assignment grants the permission (used for module access).
 * - With `regionPath`: true if an assignment grants it on that region or an ancestor.
 */
export function can(assignments: Assignment[], perm: Permission, regionPath?: string | null): boolean {
  return assignments.some(
    (a) => a.permissions.includes(perm) && (regionPath == null ? true : pathWithin(regionPath, a.regionPath)),
  );
}

/** Region paths in which the user holds `perm` (null entry = nationwide). */
export function scopesFor(assignments: Assignment[], perm: Permission): (string | null)[] {
  return assignments.filter((a) => a.permissions.includes(perm)).map((a) => a.regionPath);
}
