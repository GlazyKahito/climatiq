'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Activity, Database, FlaskConical, Radio } from 'lucide-react';
import { SeverityBadge } from '@/components/ui/badges';
import { cn } from '@/lib/utils';
import { DATA_KIND_META, fmtDate, fmtDelta, SEVERITIES, SEVERITY_META, type DataKind, type Severity } from '@/lib/domain';
import type { CommandOverview } from '@/server/command/overview';
import { severityCounts } from '@/components/map/scales';

/** Compact "18 min ago" style relative time. */
export function shortAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

const KIND_ICON = { model_forecast: Activity, simulated: FlaskConical, observed: Radio, reanalysis: Database, nwp_forecast: Activity } as const;
const KIND_VAR = { observed: 'observed', reanalysis: 'reanalysis', nwp_forecast: 'nwp', model_forecast: 'model', simulated: 'simulated' } as const;

/** One-line provenance used inside metric cards (kind + short source/time; wraps instead of overflowing). */
function Prov({ kind, text }: { kind: DataKind; text?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="flex min-w-0 items-start gap-1 text-[10px] leading-tight" style={{ color: `var(--prov-${KIND_VAR[kind]})` }} title={DATA_KIND_META[kind].description}>
      <Icon className="mt-px size-3 shrink-0" aria-hidden />
      <span className={cn('min-w-0', kind === 'simulated' && 'underline decoration-dashed underline-offset-2')}>
        <span className="font-semibold uppercase tracking-wide">{DATA_KIND_META[kind].label}</span>
        {text && <span className="opacity-80"> · {text}</span>}
      </span>
    </span>
  );
}

function Stat({ label, value, unit, children, prov }: { label: string; value: ReactNode; unit?: ReactNode; children?: ReactNode; prov?: ReactNode }) {
  return (
    <div className="glass flex min-w-0 flex-col gap-1 rounded-2xl px-3.5 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-display text-xl font-bold tabular text-fg">{value}</span>
        {unit && <span className="text-xs text-fg-muted">{unit}</span>}
      </span>
      {children && <div className="min-w-0 text-[11px] leading-snug text-fg-muted">{children}</div>}
      {prov && <div className="mt-auto pt-1">{prov}</div>}
    </div>
  );
}

/** Metric cards — every number is read from stored data and carries its provenance. */
export function MetricCards({ o, day }: { o: CommandOverview; day: string | null }) {
  const run = o.run;
  const runProv = run ? <Prov kind="model_forecast" text={`${run.modelKey} · run ${shortAgo(run.createdAt)}`} /> : undefined;
  const stateDist = day ? severityCounts(o.stateForecasts, day) : null;
  const districtDist = day ? o.districtSeverityByDay[day] : null;
  const st = o.stations.summary;
  const lastIngest = o.ingestion[0];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Key indicators" role="group" data-tour="metrics">
      <Stat label="Hottest forecast Tmax" value={o.hottest ? o.hottest.tmax.toFixed(1) : '—'} unit={o.hottest ? '°C' : undefined} prov={runProv}>
        {o.hottest ? (
          <span className="flex flex-wrap items-center gap-1">
            <span className="font-medium text-fg">{o.hottest.name}</span>· {fmtDate(o.hottest.day, { day: 'numeric', month: 'short' })}
            <SeverityBadge severity={o.hottest.sev} size="sm" />
          </span>
        ) : (
          'No forecast run for this scenario yet.'
        )}
      </Stat>

      <Stat
        label={`Heat-risk mix${day ? ` · ${fmtDate(day, { day: 'numeric', month: 'short' })}` : ''}`}
        value={stateDist ? stateDist.high + stateDist.extreme : '—'}
        unit={stateDist ? `of ${o.states.length} states ≥ High` : undefined}
        prov={runProv}
      >
        {stateDist ? (
          <span className="flex flex-col gap-1">
            <DistBar label="States" dist={stateDist} />
            {districtDist && <DistBar label="Districts" dist={districtDist} />}
          </span>
        ) : (
          'No forecast for this day.'
        )}
      </Stat>

      <Stat label="Affected · next 5 days" value={o.affected ? o.affected.districts : '—'} unit={o.affected ? 'districts ≥ High' : undefined} prov={runProv}>
        {o.affected
          ? `${o.affected.states} state${o.affected.states === 1 ? '' : 's'} ≥ High (state level)${o.affected.topStates.length ? ` · ${o.affected.topStates.slice(0, 3).map((s) => `${s.name} ${s.districts}`).join(', ')}` : ''}`
          : 'No forecast run for this scenario yet.'}
      </Stat>

      <Stat
        label="Active alerts"
        value={o.alerts ? o.alerts.open : '—'}
        unit={o.alerts ? 'open' : undefined}
        prov={
          o.alerts && o.alerts.open > 0 ? (
            <Link href="/alerts" className="text-[11px] font-semibold text-accent underline-offset-2 hover:underline">
              Open alerts →
            </Link>
          ) : (
            <Prov kind="model_forecast" text="CLIMATIQ alert rules" />
          )
        }
      >
        {o.alerts == null
          ? 'Alerts are not available for your role.'
          : o.alerts.open === 0
            ? 'No active or acknowledged alerts in your area for this scenario.'
            : `${o.alerts.active} active · ${o.alerts.acknowledged} acknowledged · ${SEVERITIES.filter((s) => o.alerts!.bySeverity[s] > 0)
                .reverse()
                .map((s) => `${o.alerts!.bySeverity[s]} ${SEVERITY_META[s].label}`)
                .join(', ')}`}
      </Stat>

      <Stat
        label="Weather stations"
        value={st.byStatus.online}
        unit={`of ${st.total} online`}
        prov={
          st.simulated > 0 ? (
            <Prov kind="simulated" text={st.real ? `${st.simulated} demo stations` : 'all demo stations'} />
          ) : st.total ? (
            <Prov kind="observed" text="IoT · unverified" />
          ) : undefined
        }
      >
        {st.total ? `${st.byStatus.degraded} degraded · ${st.byStatus.offline} offline${st.byStatus.planned ? ` · ${st.byStatus.planned} planned` : ''}` : 'No stations registered.'}
      </Stat>

      <Stat
        label="Data freshness"
        value={run ? shortAgo(run.createdAt).replace(' ago', '') : '—'}
        unit={run ? 'since forecast run' : undefined}
        prov={o.ingestionFailed24h > 0 ? <span className="text-[11px] font-semibold text-accent">{o.ingestionFailed24h} failed ingestion run(s) in 24 h</span> : undefined}
      >
        {lastIngest ? (
          <>
            Last ingestion: {lastIngest.source.replace(/\s*\(.*\)$/, '').replace(/ API$/, '')} · {lastIngest.status} · {shortAgo(lastIngest.finishedAt ?? lastIngest.startedAt)}
          </>
        ) : (
          'No ingestion runs recorded.'
        )}
      </Stat>

      {o.changes && (
        <Stat
          label="Changes vs previous run"
          value={`${o.changes.upgraded}↑ ${o.changes.downgraded}↓`}
          unit="severity"
          prov={<Prov kind="model_forecast" text={`vs run for ${fmtDate(o.changes.prevIssuedFor, { day: 'numeric', month: 'short' })}`} />}
        >
          {o.changes.compared} region-days compared · mean |ΔTmax| {o.changes.meanAbsTmaxChange.toFixed(1)} °C
          {o.changes.largest && ` · largest: ${o.changes.largest.name} ${fmtDelta(o.changes.largest.to - o.changes.largest.from)}`}
        </Stat>
      )}
    </div>
  );
}

function DistBar({ label, dist }: { label: string; dist: Record<Severity, number> }) {
  const total = SEVERITIES.reduce((n, s) => n + dist[s], 0) || 1;
  const order = [...SEVERITIES].reverse();
  return (
    <span className="flex flex-col gap-0.5">
      <span aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-line">
        {order.map((s) => (
          <span key={s} style={{ width: `${(dist[s] / total) * 100}%`, background: `var(--sev-${s})` }} />
        ))}
      </span>
      <span className="text-[10px] text-fg-muted">
        {label}: {order.map((s) => `${dist[s]} ${SEVERITY_META[s].short}`).join(' · ')}
      </span>
    </span>
  );
}
