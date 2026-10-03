import { describe, expect, it } from 'vitest';
import { can, pathWithin, ROLES, type Assignment } from '@/lib/rbac';

const a = (roleKey: keyof typeof ROLES, regionPath: string | null): Assignment => ({
  roleKey,
  regionId: regionPath ? 1 : null,
  regionCode: regionPath?.split('/').at(-1) ?? null,
  regionName: null,
  regionPath,
  permissions: ROLES[roleKey].permissions,
});

describe('pathWithin', () => {
  it('matches self and descendants only', () => {
    expect(pathWithin('IN/IN-RJ', 'IN/IN-RJ')).toBe(true);
    expect(pathWithin('IN/IN-RJ/IN-RJ-JAIPUR', 'IN/IN-RJ')).toBe(true);
    expect(pathWithin('IN/IN-RJX', 'IN/IN-RJ')).toBe(false);
    expect(pathWithin('IN/IN-MH', 'IN/IN-RJ')).toBe(false);
    expect(pathWithin('IN/IN-MH', null)).toBe(true);
  });
});

describe('can', () => {
  const stateAdmin = [a('state_admin', 'IN/IN-RJ')];
  it('grants scoped permissions within the assigned state', () => {
    expect(can(stateAdmin, 'incident:assign', 'IN/IN-RJ/IN-RJ-JAIPUR')).toBe(true);
  });
  it('denies the same permission in another state', () => {
    expect(can(stateAdmin, 'incident:assign', 'IN/IN-MH')).toBe(false);
  });
  it('module-level check ignores region', () => {
    expect(can(stateAdmin, 'admin:view')).toBe(true);
  });
  it('field responders cannot approve advisories anywhere', () => {
    expect(can([a('field_responder', null)], 'advisory:approve')).toBe(false);
  });
  it('public role has no internal permissions', () => {
    expect(can([a('public', null)], 'dashboard:view')).toBe(false);
  });
  it('system admin has every permission nationwide', () => {
    expect(can([a('system_admin', null)], 'demo:reset', 'IN/IN-KL')).toBe(true);
  });
});
