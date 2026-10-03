import Link from 'next/link';
import { Activity, ArrowRight, Database, Megaphone, RadioTower, Siren, Thermometer } from 'lucide-react';
import { DemoTag, ProvenanceBadge, SeverityBadge } from '@/components/ui/badges';
import { StationDot } from '@/components/map/station-dot';
import { AUDIENCE_META, fmtDate, fmtRelative, fmtTemp, INCIDENT_STATUS_META, PRIORITY_META } from '@/lib/domain';
import { cn } from '@/lib/utils';
import type { CommandOverview } from '@/server/command/overview';
import { CollapsiblePanel } from './collapsible-panel';

const RUN_STATUS_STYLE: Record<string, string> = {
  succeeded: 'text-[var(--sev-low-fg)]',
  partial: 'text-[var(--sev-moderate-fg)]',
  failed: 'text-[var(--sev-extreme-fg)]',
  running: 'text-fg-muted',
};

/** Server-rendered situational panels (operational ones already filtered to the user's region scope). */
export function SidePanels({ o }: { o: CommandOverview }) {
  const st = o.stations;
  const notOnline = st.items.filter((s) => s.status !== 'online').slice(0, 5);
  return (
    <>
      <CollapsiblePanel
        id="conditions"
        title="Regional conditions"
        description={o.conditions ? `Latest reanalysis day: ${fmtDate(o.conditions.day)}` : 'Recent observed / reanalysis conditions'}
        icon={<Thermometer className="size-4" aria-hidden />}
        footer={
          o.conditions && (
            <span className="flex flex-col gap-1">
              <ProvenanceBadge kind={o.conditions.kind} source={o.conditions.source.replace(/\s*\(.*\)$/, '')} updated={fmtDate(o.conditions.day)} />
              {o.conditions.day !== o.conditions.refDay && <span>ERA5 lags real time by ~5 days, so this is the latest available day before {fmtDate(o.conditions.refDay)}.</span>}
              <span>Gridded reanalysis at state centroids — not station measurements.</span>
            </span>
          )
        }
      >
        {!o.conditions ? (
          <p className="text-sm text-fg-muted">No observed or reanalysis data is stored for this period yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Hottest states on {fmtDate(o.conditions.day)}</caption>
            <thead className="text-[10px] uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="py-1">State / UT</th>
                <th scope="col" className="py-1 text-right">Tmax</th>
                <th scope="col" className="py-1 text-right">Tmin</th>
                <th scope="col" className="py-1 text-right">RH</th>
              </tr>
            </thead>
            <tbody>
              {o.conditions.rows.slice(0, 8).map((r) => (
                <tr key={r.code} className="border-t border-line">
                  <th scope="row" className="py-1 font-medium text-fg">
                    <Link href={`/command?region=${r.code}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </th>
                  <td className="py-1 text-right tabular">{fmtTemp(r.tmax)}</td>
                  <td className="py-1 text-right tabular text-fg-muted">{fmtTemp(r.tmin)}</td>
                  <td className="py-1 text-right tabular text-fg-muted">{r.rh == null ? '—' : `${Math.round(r.rh)} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        id="advisories"
        title="Active advisories"
        description="Approved or published CLIMATIQ advisories"
        icon={<Megaphone className="size-4" aria-hidden />}
        footer={
          <Link href="/advisories" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
            All advisories <ArrowRight className="size-3" aria-hidden />
          </Link>
        }
      >
        {!o.advisories || o.advisories.length === 0 ? (
          <p className="text-sm text-fg-muted">No approved or published advisories for your area in this scenario yet. Drafts appear here once a reviewer approves them.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {o.advisories.map((a) => (
              <li key={a.id}>
                <Link href={`/advisories/${a.id}`} className="block rounded-xl border border-line p-2 hover:bg-accent-soft">
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-fg">{a.title}</span>
                    <SeverityBadge severity={a.severity} size="sm" />
                  </span>
                  <span className="mt-1 block text-[11px] text-fg-muted">
                    {a.status === 'published' ? 'Published' : 'Approved'} · {AUDIENCE_META[a.audience as keyof typeof AUDIENCE_META]?.label ?? a.audience} · valid{' '}
                    {fmtDate(a.validFrom, { day: 'numeric', month: 'short' })}–{fmtDate(a.validTo, { day: 'numeric', month: 'short' })}
                    {a.regions.length ? ` · ${a.regions.slice(0, 3).join(', ')}${a.regions.length > 3 ? ` +${a.regions.length - 3}` : ''}` : ''}
                  </span>
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-fg-subtle">
                    CLIMATIQ-generated ({a.provider === 'template' ? 'template' : `AI: ${a.provider}`}) · human-approved · not official
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        id="stations"
        title="Weather stations"
        description={`${st.summary.total} registered · ${st.summary.byStatus.online} online`}
        icon={<RadioTower className="size-4" aria-hidden />}
        badge={st.summary.simulated > 0 ? <DemoTag label="Simulated" /> : undefined}
        footer={
          <span className="flex flex-col gap-1">
            {st.summary.simulated > 0 && <span>No physical stations are deployed: {st.summary.simulated} of {st.summary.total} are simulated demo stations with synthetic data.</span>}
            <Link href="/stations" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
              Station network <ArrowRight className="size-3" aria-hidden />
            </Link>
          </span>
        }
      >
        {st.summary.total === 0 ? (
          <p className="text-sm text-fg-muted">No stations registered yet.</p>
        ) : (
          <>
            <ul className="mb-2 grid grid-cols-3 gap-2 text-center">
              {(['online', 'degraded', 'offline'] as const).map((s) => (
                <li key={s} className="rounded-xl border border-line px-2 py-1.5">
                  <span className="flex items-center justify-center gap-1 text-[11px] capitalize text-fg-muted">
                    <StationDot status={s} size={10} /> {s}
                  </span>
                  <span className="font-display text-lg font-bold tabular">{st.summary.byStatus[s]}</span>
                </li>
              ))}
            </ul>
            {notOnline.length > 0 && (
              <ul className="flex flex-col gap-1">
                {notOnline.map((s) => (
                  <li key={s.code}>
                    <Link href={`/stations/${s.code}`} className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-xs hover:bg-accent-soft">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <StationDot status={s.status} simulated={s.isSimulated} size={10} />
                        <span className="truncate text-fg">{s.name}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-fg-muted">{s.lastSeenAt ? `seen ${fmtRelative(s.lastSeenAt)}` : 'never seen'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        id="response"
        title="Response activity"
        description={o.incidents ? `${o.incidents.open} open incident${o.incidents.open === 1 ? '' : 's'} in your area` : 'Open incidents by region'}
        icon={<Siren className="size-4" aria-hidden />}
        footer={
          o.incidents ? (
            <span className="flex items-center justify-between gap-2">
              <span>Read-only summary · fictional demo incidents</span>
              <Link href="/response" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                Response CRM <ArrowRight className="size-3" aria-hidden />
              </Link>
            </span>
          ) : undefined
        }
      >
        {!o.incidents ? (
          <p className="text-sm text-fg-muted">Response data is not part of your role.</p>
        ) : o.incidents.open === 0 ? (
          <p className="text-sm text-fg-muted">No open incidents in your area.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-fg-muted">
              {(['p1', 'p2', 'p3', 'p4'] as const)
                .filter((p) => o.incidents!.byPriority[p])
                .map((p) => `${o.incidents!.byPriority[p]} × ${PRIORITY_META[p].label}`)
                .join(' · ')}
            </p>
            <ul className="flex flex-wrap gap-1">
              {o.incidents.byState.map((s) => (
                <li key={s.code} className="rounded-md border border-line px-1.5 py-0.5 text-[11px]">
                  {s.name} <span className="font-semibold tabular">{s.open}</span>
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-1">
              {o.incidents.items.map((i) => (
                <li key={i.ref}>
                  <Link href={`/response/incidents/${i.ref}`} className="block rounded-lg px-1.5 py-1 text-xs hover:bg-accent-soft">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-fg">{i.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-fg-subtle">{i.ref}</span>
                    </span>
                    <span className="text-[11px] text-fg-muted">
                      {i.regionName} · {PRIORITY_META[i.priority as keyof typeof PRIORITY_META]?.label ?? i.priority} ·{' '}
                      {INCIDENT_STATUS_META[i.status as keyof typeof INCIDENT_STATUS_META]?.label ?? i.status} · updated {fmtRelative(i.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        id="ingestion"
        title="Data-ingestion health"
        description={o.ingestionFailed24h ? `${o.ingestionFailed24h} failed run(s) in the last 24 h` : 'Recent ingestion runs'}
        icon={<Database className="size-4" aria-hidden />}
        defaultOpen={false}
      >
        {o.ingestion.length === 0 ? (
          <p className="text-sm text-fg-muted">No ingestion runs recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {o.ingestion.map((r) => (
              <li key={r.id} className="rounded-lg border border-line px-2 py-1.5 text-xs">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-fg">{r.source.replace(/\s*\(.*\)$/, '')}</span>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold capitalize', RUN_STATUS_STYLE[r.status])}>
                    <Activity className="size-3" aria-hidden />
                    {r.status}
                  </span>
                </span>
                <span className="text-[11px] text-fg-muted">
                  {r.job} · {r.recordsWritten.toLocaleString('en-IN')} records · {r.triggeredBy} · {fmtRelative(r.finishedAt ?? r.startedAt)}
                  {r.sourceKind === 'simulated' ? ' · simulated' : ''}
                </span>
                {r.error && <span className="block truncate text-[11px] text-accent">{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </CollapsiblePanel>
    </>
  );
}
