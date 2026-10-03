import type { DB } from '../db/types';
import { auditLogs } from '../db/schema';

export type AuditEntry = {
  actor: { id: string; name: string } | 'system';
  action: string; // e.g. 'incident.status_change'
  entityType: string;
  entityId?: string | number | null;
  regionId?: number | null;
  before?: unknown;
  after?: unknown;
};

/** Appends an audit record. Callers pass minimal before/after snapshots (no secrets, no password hashes). */
export async function audit(db: DB, e: AuditEntry) {
  await db.insert(auditLogs).values({
    actorId: e.actor === 'system' ? null : e.actor.id,
    actorLabel: e.actor === 'system' ? 'system' : e.actor.name,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId == null ? null : String(e.entityId),
    regionId: e.regionId ?? null,
    before: e.before === undefined ? null : (e.before as object),
    after: e.after === undefined ? null : (e.after as object),
  });
}
