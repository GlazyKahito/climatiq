import Link from 'next/link';
import { CalendarDays, Gauge, LineChart, MapPin, Siren, Sparkles } from 'lucide-react';
import { EmptyState, MetricCard } from '@/components/ui/primitives';
import { DemoTag, SeverityBadge } from '@/components/ui/badges';
import { AlertStatusBadge, ScenarioBadge } from '@/components/advisories/badges';
import { FilterForm } from '@/components/advisories/filter-form';
import { Pager } from '@/components/advisories/pager';
import { alertStatusCounts, listAlerts, type AlertFilters, type AlertStatusFilter } from '@/server/alerts/service';
import type { AppUser } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { fmtDate, fmtDateTime, fmtRelative, SEVERITY_META } from '@/lib/domain';
import { can } from '@/lib/rbac';
import { AlertActions } from './alert-actions';

type SP = Record<string, string | undefined>;
const STATUS_OPTIONS: { value: AlertStatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'active', label: 'Active' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
];

export async function AlertsTab({ user, sp, scenario, stateOptions }: { user: AppUser; sp: SP; scenario: 'live' | 'replay'; stateOptions: { value: string; label: string }[] }) {
  if (!can(user.assignments, 'alert:view')) {
    return <EmptyState title="Alerts are not available for your role">CLIMATIQ alerts are shown to officials and response teams in their assigned regions.</EmptyState>;
  }
  const status = (STATUS_OPTIONS.find((o) => o.value === sp.status)?.value ?? 'open') as AlertStatusFilter;
  const scen = sp.scenario === 'all' || sp.scenario === 'live' || sp.scenario === 'replay' ? sp.scenario : scenario;
  const filters: AlertFilters = {
    status,
    severity: sp.severity && sp.severity in SEVERITY_META ? (sp.severity as AlertFilters['severity']) : undefined,
    region: sp.region && /^[A-Z0-9-]+$/.test(sp.region) ? sp.region : undefined,
    scenario: scen,
    limit: 25,
    offset: Math.max(Number(sp.offset) || 0, 0),
  };
  const db = getDb();
  const [{ items, total }, counts] = await Promise.all([listAlerts(db, user, filters), alertStatusCounts(db, user, scen === 'all' ? undefined : scen)]);
  const params = Object.fromEntries(Object.entries({ tab: 'alerts', ...sp }).filter(([k, v]) => v && k !== 'offset')) as Record<string, string>;

  return (
    <div className="flex flex-col gap-4" data-tour="alerts">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Active" value={counts.active} hint="Awaiting acknowledgement" />
        <MetricCard label="Acknowledged" value={counts.acknowledged} hint="Being handled" />
        <MetricCard label="Resolved" value={counts.resolved} hint="Closed by an official" />
        <MetricCard label="Expired" value={counts.expired} hint="Target day passed" />
      </div>
      <p className="text-xs text-fg-muted">
        Automated rule: forecast severity ≥ configured level, heuristic confidence ≥ minimum, within the configured horizon; one alert per region per run (peak day), deduplicated by
        region · day · severity with a cooldown after resolution. Alerts are CLIMATIQ decision support, not official warnings.
      </p>
      <FilterForm
        hidden={{ tab: 'alerts' }}
        fields={[
          { name: 'status', label: 'Status', type: 'select', value: status, options: STATUS_OPTIONS },
          { name: 'severity', label: 'Severity', type: 'select', value: filters.severity, allLabel: 'Any severity', options: Object.entries(SEVERITY_META).map(([v, m]) => ({ value: v, label: m.label })) },
          { name: 'region', label: 'Region', type: 'select', value: filters.region, allLabel: 'All regions', options: stateOptions },
          { name: 'scenario', label: 'Scenario', type: 'select', value: scen, options: [{ value: 'replay', label: 'Replay 2024' }, { value: 'live', label: 'Live' }, { value: 'all', label: 'All' }] },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState title="No alerts match these filters">
          {scen === 'live'
            ? 'No live forecast currently meets the alert thresholds (October has little heat risk). Switch the scenario to the May 2024 replay to explore alerts.'
            : 'Try another status or region.'}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((a) => {
            const canAck = a.status === 'active' && can(user.assignments, 'alert:acknowledge', a.regionPath);
            const canResolve = (a.status === 'active' || a.status === 'acknowledged') && can(user.assignments, 'alert:manage', a.regionPath);
            const canIncident = can(user.assignments, 'incident:create', a.regionPath);
            return (
              <li key={a.id}>
                <article className="glass flex flex-col gap-3 rounded-2xl p-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SeverityBadge severity={a.severity} size="sm" />
                      <AlertStatusBadge status={a.status} />
                      <ScenarioBadge scenario={a.scenario} />
                      {a.isDemo && <DemoTag label="Demo" />}
                    </div>
                    <h3 className="font-semibold leading-snug">
                      <Link href={`/alerts/${a.id}`} className="hover:text-accent hover:underline">
                        {a.title}
                      </Link>
                    </h3>
                    <p className="line-clamp-2 text-sm text-fg-muted">{a.message}</p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                      <span className="inline-flex items-center gap-1">
                        <MapPin aria-hidden className="size-3.5" /> {a.regionName} <span className="capitalize">({a.regionLevel})</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays aria-hidden className="size-3.5" /> Target {fmtDate(a.targetDate)}
                      </span>
                      <span className="inline-flex items-center gap-1" title="Heuristic confidence score — not a probability">
                        <Gauge aria-hidden className="size-3.5" /> Confidence {a.confidenceScore.toFixed(2)}
                      </span>
                      <span title={fmtDateTime(a.createdAt)}>Raised {fmtRelative(a.createdAt)}</span>
                      {a.acknowledgedBy && <span>Ack. by {a.acknowledgedBy}</span>}
                      {a.incidentRefs.map((ref) => (
                        <Link key={ref} href={`/response/incidents/${ref}`} className="font-mono font-medium text-accent hover:underline">
                          {ref}
                        </Link>
                      ))}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 lg:items-end">
                    <AlertActions id={a.id} canAck={canAck} canResolve={canResolve} />
                    <div className="flex flex-wrap gap-1.5 lg:justify-end">
                      <Link href={`/forecasts/${a.regionCode}`} className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-fg-muted hover:bg-accent-soft hover:text-fg">
                        <LineChart aria-hidden className="size-3.5" /> Forecast
                      </Link>
                      {can(user.assignments, 'advisory:generate', a.regionPath) && (
                        <Link href={`/advisories/new?region=${a.regionCode}`} className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-fg-muted hover:bg-accent-soft hover:text-fg">
                          <Sparkles aria-hidden className="size-3.5" /> Advisory
                        </Link>
                      )}
                      {canIncident && (
                        <Link href={`/response/incidents/new?alert=${a.id}`} className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold text-accent hover:bg-accent-soft">
                          <Siren aria-hidden className="size-3.5" /> Create incident
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      <Pager total={total} limit={filters.limit!} offset={filters.offset!} params={params} path="/advisories" />
    </div>
  );
}
