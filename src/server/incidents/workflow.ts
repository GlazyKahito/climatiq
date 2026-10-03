/**
 * Incident workflow rules (pure, unit-tested).
 *
 *   reported → triaged → in_progress ⇄ monitoring → resolved → closed
 *   any active state → resolved (e.g. false alarm / handled quickly) — resolution summary required
 *   resolved | closed → in_progress  (reopen)
 *
 * Permissions: ordinary moves need `incident:update`; resolving, closing and reopening need `incident:close`.
 */
import type { IncidentStatus } from '@/lib/domain';
import type { Permission } from '@/lib/rbac';

export const INCIDENT_STATUSES: IncidentStatus[] = ['reported', 'triaged', 'in_progress', 'monitoring', 'resolved', 'closed'];
export const ACTIVE_STATUSES: IncidentStatus[] = ['reported', 'triaged', 'in_progress', 'monitoring'];

export const INCIDENT_FLOW: Record<IncidentStatus, IncidentStatus[]> = {
  reported: ['triaged', 'resolved'],
  triaged: ['in_progress', 'resolved'],
  in_progress: ['monitoring', 'resolved'],
  monitoring: ['in_progress', 'resolved'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
};

export const isReopen = (from: IncidentStatus, to: IncidentStatus) => (from === 'resolved' || from === 'closed') && to === 'in_progress';

export function permissionForTransition(from: IncidentStatus, to: IncidentStatus): Permission {
  return to === 'resolved' || to === 'closed' || isReopen(from, to) ? 'incident:close' : 'incident:update';
}

export function transitionLabel(from: IncidentStatus, to: IncidentStatus): string {
  if (isReopen(from, to)) return 'Reopen';
  return (
    {
      reported: 'Mark reported',
      triaged: 'Triage',
      in_progress: from === 'monitoring' ? 'Resume response' : 'Start response',
      monitoring: 'Move to monitoring',
      resolved: 'Resolve',
      closed: 'Close',
    } as const
  )[to];
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function validateTransition(
  from: IncidentStatus,
  to: IncidentStatus,
  opts: { resolutionSummary?: string | null; existingSummary?: string | null } = {},
): TransitionCheck {
  if (from === to) return { ok: false, reason: `Incident is already ${to}` };
  if (!INCIDENT_FLOW[from].includes(to)) return { ok: false, reason: `Cannot move an incident from ${from} to ${to}` };
  const summary = (opts.resolutionSummary ?? '').trim() || (opts.existingSummary ?? '').trim();
  if ((to === 'resolved' || to === 'closed') && summary.length < 10) {
    return { ok: false, reason: 'A resolution summary (at least 10 characters) is required to resolve or close an incident' };
  }
  return { ok: true };
}

export function isActive(s: IncidentStatus) {
  return ACTIVE_STATUSES.includes(s);
}
