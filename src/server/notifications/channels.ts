/**
 * Notification delivery. `NotificationChannel` is the extension point (email/SMS/WhatsApp could be added later);
 * only the in-app channel is implemented — CLIMATIQ sends nothing outside the app.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { notifications } from '../db/schema';
import type { Severity } from '@/lib/domain';

export type NotificationKind = 'alert' | 'advisory' | 'incident' | 'system';

export type NotificationPayload = {
  kind: NotificationKind;
  severity?: Severity | null;
  title: string;
  body: string;
  link?: string | null;
  regionId?: number | null;
  alertId?: string | null;
  advisoryId?: string | null;
  incidentId?: string | null;
  isDemo?: boolean;
  createdAt?: Date;
};

export type DeliveryResult = { channel: string; delivered: number; skipped: number };

export interface NotificationChannel {
  readonly key: string;
  deliver(db: DB, userIds: string[], payload: NotificationPayload): Promise<DeliveryResult>;
}

/** Stores notifications for the in-app inbox. At most one notification per (user, alert) — enforced by a unique index. */
export class InAppChannel implements NotificationChannel {
  readonly key = 'in_app';

  async deliver(db: DB, userIds: string[], p: NotificationPayload): Promise<DeliveryResult> {
    const unique = [...new Set(userIds)];
    if (!unique.length) return { channel: this.key, delivered: 0, skipped: 0 };
    let delivered = 0;
    for (let i = 0; i < unique.length; i += 200) {
      const rows = unique.slice(i, i + 200).map((userId) => ({
        userId,
        channel: this.key,
        kind: p.kind,
        severity: p.severity ?? null,
        title: p.title.slice(0, 200),
        body: p.body.slice(0, 1000),
        link: p.link ?? null,
        regionId: p.regionId ?? null,
        alertId: p.alertId ?? null,
        advisoryId: p.advisoryId ?? null,
        incidentId: p.incidentId ?? null,
        isDemo: p.isDemo ?? false,
        ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      }));
      const inserted = await db
        .insert(notifications)
        .values(rows)
        // (user_id, alert_id) is unique where alert_id is not null → re-notifying the same alert is a no-op.
        .onConflictDoNothing({ target: [notifications.userId, notifications.alertId], where: sql`${notifications.alertId} is not null` })
        .returning({ id: notifications.id });
      delivered += inserted.length;
    }
    return { channel: this.key, delivered, skipped: unique.length - delivered };
  }
}

export const CHANNELS: NotificationChannel[] = [new InAppChannel()];

export async function notifyUsers(db: DB, userIds: string[], payload: NotificationPayload, channels: NotificationChannel[] = CHANNELS) {
  const results: DeliveryResult[] = [];
  for (const c of channels) results.push(await c.deliver(db, userIds, payload));
  return results;
}
