import { describe, expect, it } from 'vitest';
import { INCIDENT_FLOW, isReopen, permissionForTransition, validateTransition } from '@/server/incidents/workflow';

describe('incident workflow', () => {
  it('follows reported → triaged → in_progress → monitoring → resolved → closed', () => {
    expect(validateTransition('reported', 'triaged').ok).toBe(true);
    expect(validateTransition('triaged', 'in_progress').ok).toBe(true);
    expect(validateTransition('in_progress', 'monitoring').ok).toBe(true);
    expect(validateTransition('monitoring', 'in_progress').ok).toBe(true);
    expect(validateTransition('monitoring', 'resolved', { resolutionSummary: 'Cooling points handled the load.' }).ok).toBe(true);
    expect(validateTransition('resolved', 'closed', { existingSummary: 'Cooling points handled the load.' }).ok).toBe(true);
  });

  it('rejects skipping steps and same-state moves', () => {
    expect(validateTransition('reported', 'in_progress').ok).toBe(false);
    expect(validateTransition('reported', 'closed', { resolutionSummary: 'long enough summary' }).ok).toBe(false);
    expect(validateTransition('triaged', 'monitoring').ok).toBe(false);
    expect(validateTransition('in_progress', 'in_progress').ok).toBe(false);
    expect(validateTransition('closed', 'resolved', { resolutionSummary: 'long enough summary' }).ok).toBe(false);
  });

  it('requires a resolution summary to resolve or close', () => {
    const r = validateTransition('in_progress', 'resolved');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/resolution summary/);
    expect(validateTransition('in_progress', 'resolved', { resolutionSummary: 'too short' }).ok).toBe(false);
    expect(validateTransition('resolved', 'closed', { existingSummary: null }).ok).toBe(false);
  });

  it('supports reopening resolved and closed incidents', () => {
    expect(isReopen('resolved', 'in_progress')).toBe(true);
    expect(isReopen('closed', 'in_progress')).toBe(true);
    expect(validateTransition('closed', 'in_progress').ok).toBe(true);
    expect(INCIDENT_FLOW.closed).toEqual(['in_progress']);
  });

  it('maps transitions to permissions', () => {
    expect(permissionForTransition('reported', 'triaged')).toBe('incident:update');
    expect(permissionForTransition('in_progress', 'monitoring')).toBe('incident:update');
    expect(permissionForTransition('monitoring', 'resolved')).toBe('incident:close');
    expect(permissionForTransition('resolved', 'closed')).toBe('incident:close');
    expect(permissionForTransition('closed', 'in_progress')).toBe('incident:close');
  });
});
