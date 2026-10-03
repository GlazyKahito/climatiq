import { Bell, BellRing, FileText, MapPin, Siren, Settings2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/primitives';
import { SeverityBadge } from '@/components/ui/badges';
import { FilterForm } from '@/components/advisories/filter-form';
import { Pager } from '@/components/advisories/pager';
import { listNotifications, type NotificationFilters } from '@/server/notifications/inbox';
import type { AppUser } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { fmtDateTime, fmtRelative, SEVERITY_META } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { MarkAllReadButton, NotificationLink, ToggleReadButton } from './notification-actions';

type SP = Record<string, string | undefined>;
const KIND = {
  alert: { label: 'Alert', icon: BellRing },
  advisory: { label: 'Advisory', icon: FileText },
  incident: { label: 'Incident', icon: Siren },
  system: { label: 'System', icon: Settings2 },
} as const;

export async function NotificationsTab({ user, sp, stateOptions }: { user: AppUser; sp: SP; stateOptions: { value: string; label: string }[] }) {
  const filters: NotificationFilters = {
    status: sp.status === 'unread' || sp.status === 'read' ? sp.status : 'all',
    kind: sp.kind && sp.kind in KIND ? (sp.kind as NotificationFilters['kind']) : undefined,
    severity: sp.severity && sp.severity in SEVERITY_META ? (sp.severity as NotificationFilters['severity']) : undefined,
    region: sp.region && /^[A-Z0-9-]+$/.test(sp.region) ? sp.region : undefined,
    limit: 30,
    offset: Math.max(Number(sp.offset) || 0, 0),
  };
  const res = await listNotifications(getDb(), user.id, filters);
  const params = Object.fromEntries(Object.entries({ tab: 'notifications', ...sp }).filter(([k, v]) => v && k !== 'offset')) as Record<string, string>;

  return (
    <div className="flex flex-col gap-4">
      <FilterForm
        hidden={{ tab: 'notifications' }}
        extra={<MarkAllReadButton disabled={res.unread === 0} />}
        fields={[
          { name: 'status', label: 'Read state', type: 'select', value: filters.status === 'all' ? '' : filters.status, allLabel: 'All', options: [{ value: 'unread', label: `Unread (${res.unread})` }, { value: 'read', label: 'Read' }] },
          { name: 'kind', label: 'Type', type: 'select', value: filters.kind, allLabel: 'All types', options: Object.entries(KIND).map(([v, m]) => ({ value: v, label: m.label })) },
          { name: 'severity', label: 'Severity', type: 'select', value: filters.severity, allLabel: 'Any severity', options: Object.entries(SEVERITY_META).map(([v, m]) => ({ value: v, label: m.label })) },
          { name: 'region', label: 'Region', type: 'select', value: filters.region, allLabel: 'All regions', options: stateOptions },
        ]}
      />
      <p className="text-xs text-fg-subtle">In-app notifications only (no SMS/e-mail). Alert notifications are CLIMATIQ-generated decision support, not official warnings.</p>
      {res.items.length === 0 ? (
        <EmptyState title={filters.status === 'unread' ? 'You’re all caught up' : 'No notifications'}>
          You are notified about CLIMATIQ alerts in your assigned regions, advisories awaiting review and incident assignments.
        </EmptyState>
      ) : (
        <ul className="glass divide-y divide-line overflow-hidden rounded-2xl">
          {res.items.map((n) => {
            const K = KIND[n.kind as keyof typeof KIND] ?? { label: n.kind, icon: Bell };
            const Icon = K.icon;
            return (
              <li key={n.id} className={cn('flex items-start gap-3 px-4 py-3', !n.read && 'bg-accent-soft/50')}>
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" title={K.label}>
                  <Icon aria-hidden className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!n.read && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                    <NotificationLink id={n.id} href={n.link ?? '/advisories?tab=notifications'} read={n.read} className={cn('text-sm hover:text-accent hover:underline', n.read ? 'font-medium' : 'font-semibold')}>
                      {n.title}
                    </NotificationLink>
                    {n.severity && <SeverityBadge severity={n.severity} size="sm" />}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-fg-muted">{n.body}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
                    <span>{K.label}</span>
                    {n.regionName && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin aria-hidden className="size-3" /> {n.regionName}
                      </span>
                    )}
                    <time dateTime={n.createdAt} title={fmtDateTime(n.createdAt)}>
                      {fmtRelative(n.createdAt)} · {fmtDateTime(n.createdAt)}
                    </time>
                    {n.readAt && <span>Read {fmtRelative(n.readAt)}</span>}
                  </p>
                </div>
                <ToggleReadButton id={n.id} read={n.read} />
              </li>
            );
          })}
        </ul>
      )}
      <Pager total={res.total} limit={res.limit} offset={res.offset} params={params} path="/advisories" />
    </div>
  );
}
