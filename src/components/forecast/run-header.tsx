import { CalendarClock, Cpu, History, Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import { DemoTag, OriginTag, ProvenanceBadge } from '@/components/ui/badges';
import { fmtDate, fmtDateTime, fmtRelative, type DataKind } from '@/lib/domain';
import { isDataKind, KIND_SOURCE, SCENARIO_LABEL, triggeredByLabel } from './labels';

export type RunHeaderData = {
  id: string;
  scenario: 'live' | 'replay';
  issuedFor: string;
  horizonDays: number;
  isHindcast: boolean;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  triggeredBy: string;
  modelKey: string;
  modelName: string;
  modelMethod: string;
  regionsCount: number;
  error: string | null;
};

function Item({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">{label}</p>
        <div className="text-sm text-fg">{children}</div>
      </div>
    </div>
  );
}

/** Run metadata: scenario, model version, issue date, generation time, inputs and hindcast flag. */
export function RunHeader({ run, inputKinds }: { run: RunHeaderData; inputKinds: string[] }) {
  const kinds: DataKind[] = ['model_forecast', ...inputKinds.filter(isDataKind).filter((k) => k !== 'model_forecast')];
  const simulated = kinds.includes('simulated');
  return (
    <section aria-label="Forecast run" className="glass rounded-[var(--radius-glass)] px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-wine px-3 py-1 text-xs font-semibold text-sand dark:bg-accent dark:text-accent-fg">
          {run.scenario === 'replay' ? <History className="size-3.5" aria-hidden /> : <span className="size-2 rounded-full bg-current" aria-hidden />}
          {SCENARIO_LABEL[run.scenario]}
        </span>
        {run.isHindcast && (
          <span className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted" title="Produced after the fact using only data available up to the issue date; used to evaluate the model.">
            Hindcast
          </span>
        )}
        {run.status === 'partial' && (
          <span className="rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted" title={run.error ?? undefined}>
            Partial run
          </span>
        )}
        <OriginTag origin="climatiq" />
        {simulated && <DemoTag label="Includes simulated inputs" />}
      </div>
      <div role="group" aria-label="Run details" className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Item icon={<Cpu className="size-3.5" />} label="Model version">
          <span className="font-mono text-[13px]">{run.modelKey}</span> <span className="text-fg-muted">· {run.modelName}</span>
        </Item>
        <Item icon={<CalendarClock className="size-3.5" />} label="Issued for (day 0)">
          {fmtDate(run.issuedFor, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          <span className="text-fg-muted"> · {run.horizonDays}-day horizon</span>
        </Item>
        <Item icon={<History className="size-3.5" />} label="Generated">
          <time dateTime={run.createdAt}>{fmtDateTime(run.createdAt)}</time>
          <span className="text-fg-muted"> · {fmtRelative(run.createdAt)} by {triggeredByLabel(run.triggeredBy)}</span>
        </Item>
        <Item icon={<Layers className="size-3.5" />} label="Coverage">
          {run.regionsCount > 0 ? `${run.regionsCount} regions` : '—'}
          <span className="text-fg-muted"> · states + pilot districts</span>
        </Item>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">Inputs & output</span>
        {kinds.map((k) => (
          <ProvenanceBadge
            key={k}
            kind={k}
            source={k === 'model_forecast' ? run.modelKey : k === 'nwp_forecast' && run.scenario === 'replay' ? 'Open-Meteo Previous Runs API (as issued)' : KIND_SOURCE[k]}
          />
        ))}
        {inputKinds.includes('climatology') && (
          <span className="rounded-md border border-line px-2 py-0.5 text-[11px] text-fg-muted" title="Few-year ERA5 day-of-year mean — not an official 30-year normal.">
            + reference climatology (ERA5, few-year mean)
          </span>
        )}
      </div>
    </section>
  );
}
