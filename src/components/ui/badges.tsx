import { Activity, AlertOctagon, AlertTriangle, CircleCheck, Cpu, Database, FlaskConical, Radio, ShieldCheck, Thermometer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONFIDENCE_META, DATA_KIND_META, SEVERITY_META, type Confidence, type DataKind, type Severity } from '@/lib/domain';

const SEV_ICON = { low: CircleCheck, moderate: Thermometer, high: AlertTriangle, extreme: AlertOctagon } as const;

/** Severity is always conveyed by icon + text, colour is supplementary. */
export function SeverityBadge({ severity, size = 'md', className }: { severity: Severity; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = SEV_ICON[severity];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
        size === 'sm' && 'px-2 py-0.5 text-[11px]',
        size === 'md' && 'px-2.5 py-0.5 text-xs',
        size === 'lg' && 'px-3 py-1 text-sm',
        className,
      )}
      style={{ color: `var(--sev-${severity}-fg)`, background: `var(--sev-${severity}-bg)`, border: `1px solid color-mix(in srgb, var(--sev-${severity}) 45%, transparent)` }}
      title={SEVERITY_META[severity].description}
    >
      <Icon aria-hidden className={size === 'lg' ? 'size-4' : 'size-3.5'} />
      {SEVERITY_META[severity].label}
    </span>
  );
}

const KIND_ICON = { observed: Radio, reanalysis: Database, nwp_forecast: Cpu, model_forecast: Activity, simulated: FlaskConical } as const;
const KIND_VAR = { observed: 'observed', reanalysis: 'reanalysis', nwp_forecast: 'nwp', model_forecast: 'model', simulated: 'simulated' } as const;

/** Provenance label: what kind of data this is, where it came from and when it was updated. */
export function ProvenanceBadge({
  kind,
  source,
  updated,
  className,
}: {
  kind: DataKind;
  source?: string;
  updated?: string;
  className?: string;
}) {
  const Icon = KIND_ICON[kind];
  const meta = DATA_KIND_META[kind];
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium',
        kind === 'simulated' && 'border-dashed',
        className,
      )}
      style={{ color: `var(--prov-${KIND_VAR[kind]})`, border: `1px ${kind === 'simulated' ? 'dashed' : 'solid'} color-mix(in srgb, var(--prov-${KIND_VAR[kind]}) 45%, transparent)` }}
      title={`${meta.label}: ${meta.description}${source ? ` Source: ${source}.` : ''}${updated ? ` Updated ${updated}.` : ''}`}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="uppercase tracking-wide">{meta.label}</span>
      {source && <span className="truncate opacity-80">· {source}</span>}
      {updated && <span className="whitespace-nowrap opacity-70">· {updated}</span>}
    </span>
  );
}

export function ConfidenceBadge({ confidence, score }: { confidence: Confidence; score?: number }) {
  const bars = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted" title={`${CONFIDENCE_META[confidence].description} Heuristic score — not a calibrated probability.`}>
      <span aria-hidden className="flex items-end gap-0.5">
        {[1, 2, 3].map((b) => (
          <span key={b} className={cn('w-1 rounded-sm', b <= bars ? 'bg-accent' : 'bg-line-strong')} style={{ height: 4 + b * 3 }} />
        ))}
      </span>
      {CONFIDENCE_META[confidence].label}
      {score != null && <span className="tabular opacity-70">({score.toFixed(2)})</span>}
    </span>
  );
}

/** Marks content as official (verified source) vs CLIMATIQ-generated. */
export function OriginTag({ origin }: { origin: 'official' | 'climatiq' }) {
  return origin === 'official' ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-[#1d4f7a] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
      <ShieldCheck aria-hidden className="size-3" /> Official source
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-accent/40 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
      <Activity aria-hidden className="size-3" /> CLIMATIQ-generated · not official
    </span>
  );
}

export function DemoTag({ className, label = 'Demo data' }: { className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', className)} style={{ color: 'var(--prov-simulated)', borderColor: 'var(--prov-simulated)' }}>
      <FlaskConical aria-hidden className="size-3" /> {label}
    </span>
  );
}
