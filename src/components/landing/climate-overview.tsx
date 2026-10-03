import Link from 'next/link';
import { ArrowRight, CalendarClock, History, RadioTower } from 'lucide-react';
import { OriginTag, ProvenanceBadge, SeverityBadge } from '@/components/ui/badges';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { SEVERITIES, fmtDate, fmtDelta, fmtTemp, type DataKind, type Severity } from '@/lib/domain';
import { cn } from '@/lib/utils';
import type { LandingScenarioSummary, LandingSummary } from '@/server/landing/summary';

const KIND_SOURCE: Record<string, string> = {
  reanalysis: 'ERA5 via Open-Meteo',
  nwp_forecast: 'Open-Meteo',
  observed: 'Stations',
  simulated: 'Simulator',
  model_forecast: 'CLIMATIQ',
};

/** Presentational climate overview (data is fetched by the caller from `getLandingSummary`). */
export function ClimateOverviewView({ summary }: { summary: LandingSummary | null }) {
  if (!summary) {
    return (
      <div role="alert" className="glass rounded-3xl p-6 text-sm text-fg-muted">
        The climate overview is temporarily unavailable (the database could not be reached). The rest of the page works
        normally — try again in a moment.
      </div>
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ScenarioCard
        kind="replay"
        data={summary.replay}
        title="Historical replay: May 2024"
        subtitle="ERA5 + CLIMATIQ hindcast"
        empty="No replay run has been generated yet. It is created from real ERA5 reanalysis when the demo database is seeded."
      />
      <ScenarioCard
        kind="live"
        data={summary.live}
        title="Live"
        subtitle="Open-Meteo NWP + CLIMATIQ forecast"
        empty="No live forecast run is available yet — live runs need Open-Meteo to be reachable. Nothing is shown in its place."
      />
    </div>
  );
}

function ScenarioCard({
  kind,
  data,
  title,
  subtitle,
  empty,
}: {
  kind: 'replay' | 'live';
  data: LandingScenarioSummary | null;
  title: string;
  subtitle: string;
  empty: string;
}) {
  const Icon = kind === 'replay' ? History : RadioTower;
  return (
    <article className="glass-strong flex min-w-0 flex-col rounded-3xl p-5 sm:p-6" aria-labelledby={`overview-${kind}`}>
      <header className="flex flex-wrap items-start gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', kind === 'replay' ? 'bg-accent-soft text-accent' : 'bg-[var(--sev-low-bg)] text-sev-low')}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`overview-${kind}`} className="font-heading text-lg font-semibold">
            {title}
            <span className="font-normal text-fg-muted"> · {subtitle}</span>
          </h3>
          {data && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
              <CalendarClock className="size-3.5" aria-hidden />
              {kind === 'replay' ? 'Hindcast' : 'Forecast'} for <strong className="font-semibold text-fg">{fmtDate(data.targetDate)}</strong>
              <span>· issued as of {fmtDate(data.run.issuedFor)}</span>
              <span>· {data.run.modelName}</span>
            </p>
          )}
        </div>
      </header>

      {!data ? (
        <div className="mt-5">
          <EmptyState title={kind === 'replay' ? 'Replay not generated yet' : 'No live run yet'}>{empty}</EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <OriginTag origin="climatiq" />
            <ProvenanceBadge kind="model_forecast" source={`${data.run.modelKey}${data.run.isHindcast ? ' hindcast' : ''}`} />
            {data.inputKinds
              .filter((k): k is DataKind => k in KIND_SOURCE && k !== 'model_forecast')
              .map((k) => (
                <ProvenanceBadge key={k} kind={k} source={KIND_SOURCE[k]} />
              ))}
          </div>

          <SeverityStrip counts={data.counts} total={data.regionsTotal} level={data.level} />

          <div className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-subtle">
              Highest-risk {data.level === 'district' ? 'districts' : 'states'}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <caption className="sr-only">
                  {title}: top {data.top.length} {data.level}s by CLIMATIQ risk level for {fmtDate(data.targetDate)}
                </caption>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                    <th scope="col" className="py-1.5 pr-2 font-medium">Region</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">Risk</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">Tmax</th>
                    <th scope="col" className="py-1.5 text-right font-medium">vs normal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((r) => (
                    <tr key={r.code} className="border-t border-line">
                      <td className="py-2 pr-2">
                        <span className="font-medium">{r.name}</span>
                        {r.parentName && <span className="text-fg-muted">, {r.parentName}</span>}
                        <span className="block text-[11px] text-fg-subtle">{r.resolution.replace(/-/g, ' ')}</span>
                      </td>
                      <td className="py-2 pr-2">
                        <SeverityBadge severity={r.severity} size="sm" />
                      </td>
                      <td className="py-2 pr-2 text-right font-mono tabular">{fmtTemp(r.predictedTmaxC)}</td>
                      <td className="py-2 text-right font-mono tabular text-fg-muted">{fmtDelta(r.departureC)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <footer className="mt-auto pt-5 text-xs text-fg-subtle">
            {kind === 'replay'
              ? 'A replay of a real past event — not a current emergency. Normals are a five-year ERA5 reference, not IMD official normals.'
              : 'Model output for planning support. Check IMD for official warnings.'}{' '}
            <Link href="/methodology" className="font-medium text-accent underline-offset-4 hover:underline">
              Methodology
            </Link>
          </footer>
        </>
      )}
    </article>
  );
}

function SeverityStrip({ counts, total, level }: { counts: Record<Severity, number>; total: number; level: 'district' | 'state' }) {
  const order = [...SEVERITIES].reverse();
  return (
    <div className="mt-5">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
        {order.map((s) =>
          counts[s] > 0 ? <span key={s} style={{ width: `${(counts[s] / Math.max(1, total)) * 100}%`, background: `var(--sev-${s})` }} /> : null,
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {order.map((s) => (
          <div key={s} className="rounded-xl border border-line px-3 py-2">
            <dt>
              <SeverityBadge severity={s} size="sm" />
            </dt>
            <dd className="mt-1 font-display text-xl font-bold tabular">
              {counts[s]}
              <span className="ml-1 font-sans text-xs font-normal text-fg-subtle">{level === 'district' ? 'districts' : 'states'}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ClimateOverviewSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Loading climate overview">
      {[0, 1].map((i) => (
        <div key={i} className="glass-strong space-y-4 rounded-3xl p-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-2.5 w-full" />
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((j) => (
              <Skeleton key={j} className="h-14" />
            ))}
          </div>
          <Skeleton className="h-32 w-full" />
        </div>
      ))}
    </div>
  );
}

export function OverviewCta() {
  return (
    <Link href="/command" className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
      See every district in the command center
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
