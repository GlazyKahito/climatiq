import Link from 'next/link';
import { ArrowRight, ExternalLink, ShieldAlert } from 'lucide-react';
import { ConfidenceBadge, SeverityBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/primitives';
import { fmtDateTime, SEVERITY_META, type Confidence, type Severity } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { shortDay, signed, t1, weekdayDay } from '@/components/charts/format';

export type RiskItem = {
  code: string;
  name: string;
  level: string;
  stateName: string;
  severity: Severity;
  predictedTmaxC: number;
  lowerC: number;
  upperC: number;
  departureC: number | null;
  confidence: Confidence;
  confidenceScore: number;
  durationDays: number;
};

/** Ranked list of the highest-risk regions for the selected day. */
export function TopRisks({ items, dayLabel }: { items: RiskItem[]; dayLabel: string }) {
  if (!items.length)
    return (
      <EmptyState title="No elevated heat risk">
        No state or pilot district reaches Moderate or above on {dayLabel} in this run.
      </EmptyState>
    );
  return (
    <ol className="flex flex-col divide-y divide-line">
      {items.map((r, i) => (
        <li key={r.code}>
          <Link href={`/forecasts/${r.code}`} className="group flex items-center gap-3 rounded-lg px-1 py-2.5 hover:bg-accent-soft">
            <span className="w-5 text-right font-display text-xs font-bold text-fg-subtle tabular" aria-hidden>
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold group-hover:text-accent">{r.name}</span>
              <span className="block truncate text-[11px] text-fg-subtle">
                {r.level === 'state' ? 'State / UT' : `District · ${r.stateName}`}
                {r.durationDays > 1 ? ` · ${r.durationDays} d ≥ High` : ''}
              </span>
            </span>
            <span className="text-right">
              <span className="block text-sm font-semibold tabular">{t1(r.predictedTmaxC)}</span>
              <span className="block text-[11px] text-fg-subtle tabular">{signed(r.departureC)} vs normal</span>
            </span>
            <SeverityBadge severity={r.severity} size="sm" />
          </Link>
        </li>
      ))}
    </ol>
  );
}

export type StripDay = { day: string; horizonDay: number; severity: Severity; predictedTmaxC: number; lowerC: number; upperC: number; confidence: Confidence; confidenceScore: number };

/** Per-day severity strip (icon + text chips — never colour alone). */
export function SeverityStrip({ days }: { days: StripDay[] }) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Severity by forecast day">
      {days.map((d) => (
        <li
          key={d.day}
          className="flex flex-col gap-1 rounded-xl border px-2.5 py-2"
          style={{ borderColor: `color-mix(in srgb, var(--sev-${d.severity}) 35%, transparent)`, background: `var(--sev-${d.severity}-bg)` }}
        >
          <span className="flex items-center justify-between gap-1 text-[11px] text-fg-muted">
            <span className="font-semibold text-fg">{weekdayDay(d.day)}</span>
            <span className="tabular">D+{d.horizonDay}</span>
          </span>
          <SeverityBadge severity={d.severity} size="sm" className="self-start" />
          <span className="text-sm font-semibold tabular">{t1(d.predictedTmaxC)}</span>
          <span className="text-[11px] text-fg-subtle tabular">
            band {d.lowerC.toFixed(1)}–{d.upperC.toFixed(1)}
          </span>
          <ConfidenceBadge confidence={d.confidence} />
        </li>
      ))}
    </ol>
  );
}

export type ChildChip = { code: string; name: string; hasForecast: boolean; peakSeverity: Severity | null; peakTmaxC: number | null };

/** Drill-down list of child regions with mini severity chips. */
export function ChildrenList({ items, childLabel }: { items: ChildChip[]; childLabel: string }) {
  if (!items.length) return <p className="text-sm text-fg-muted">No {childLabel} are loaded for this region (only pilot states have districts and cities).</p>;
  return (
    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((c) => (
        <li key={c.code}>
          <Link href={`/forecasts/${c.code}`} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:border-accent/40 hover:bg-accent-soft">
            <span className="min-w-0 truncate font-medium">{c.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              {c.peakTmaxC != null && <span className="text-[11px] text-fg-subtle tabular">{t1(c.peakTmaxC)}</span>}
              {c.peakSeverity ? <SeverityBadge severity={c.peakSeverity} size="sm" /> : <span className="text-[11px] text-fg-subtle">{c.hasForecast ? '—' : 'uses parent forecast'}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export type WarningItem = { id: number; colorCode: string; title: string; issuedAt: string; validFrom: string; validTo: string; url: string; retrievedAt: string; verified: boolean; source: string; regionName: string };

const IMD_COLOUR: Record<string, string> = { green: '#2e7d32', yellow: '#c9a100', orange: '#e06c00', red: '#c62828' };

/** Official (IMD) warnings — shown only when retrieved from a verifiable source; otherwise explains why none appear. */
export function OfficialWarnings({ warnings, imdConfigured }: { warnings: WarningItem[]; imdConfigured: boolean }) {
  if (warnings.length)
    return (
      <ul className="flex flex-col gap-2">
        {warnings.map((w) => (
          <li key={w.id} className="rounded-xl border border-line px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-[#1d4f7a] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                <ShieldAlert className="size-3" aria-hidden /> Official · {w.source}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold capitalize">
                <span className="size-2.5 rounded-full" style={{ background: IMD_COLOUR[w.colorCode] }} aria-hidden />
                {w.colorCode} warning
              </span>
              {!w.verified && <span className="text-[11px] text-fg-subtle">(not yet verified)</span>}
            </div>
            <p className="mt-1 text-sm font-medium">{w.title}</p>
            <p className="text-xs text-fg-muted">
              {w.regionName} · valid {fmtDateTime(w.validFrom)} – {fmtDateTime(w.validTo)} · retrieved {fmtDateTime(w.retrievedAt)}
            </p>
            <a href={w.url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline">
              Open the official bulletin <ExternalLink className="size-3" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="flex flex-col gap-2 text-sm text-fg-muted">
      <p>
        <strong className="text-fg">No official warnings are shown.</strong>{' '}
        {imdConfigured
          ? 'The IMD integration is configured but no warning has been retrieved for this region and period.'
          : 'The India Meteorological Department (IMD) integration is not configured: IMD’s warning API requires registration, an API key and approval, which this prototype does not have. CLIMATIQ never infers or re-labels its own output as an official warning.'}
      </p>
      <a href="https://mausam.imd.gov.in" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 self-start font-medium text-accent hover:underline">
        Check official IMD warnings at mausam.imd.gov.in <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </div>
  );
}

/** Limitations & uncertainty block shared by forecast pages. */
export function Limitations({ hindcast, resolution, isCity }: { hindcast: boolean; resolution: string; isCity?: boolean }) {
  const items = [
    'CLIMATIQ output is decision support, not an official forecast or warning. Always defer to IMD and state authorities.',
    'The uncertainty band is a nominal 80 % interval from a heuristic spread (σ grows with lead time and NWP–persistence disagreement). It is not calibrated, so real coverage may differ — see Climate analytics › Forecast accuracy.',
    'Confidence is a heuristic score derived from that spread and input completeness. It is not a probability.',
    'Severity applies IMD heatwave criteria (40 / 37 / 30 °C base thresholds for plains / coastal / hills, 4.5 °C and 6.5 °C departures, 45 / 47 °C absolute) to a single grid point against a few-year ERA5 reference normal, not IMD’s 1991–2020 station normals, and without IMD’s two-station / two-consecutive-day declaration rule. It is an indicator, not a declaration.',
    `Spatial resolution: ${resolution}. Values do not represent every location in the region; urban heat islands, elevation and coastal effects can differ markedly.${isCity ? ' Cities show their district’s forecast.' : ''}`,
    'ERA5 reanalysis is a model-based reconstruction of past weather, available with about a 5-day delay; it is not a station measurement.',
    hindcast
      ? 'This is a hindcast: it was generated after the fact using only history and archived NWP guidance available up to the issue date. Verification against later reanalysis is shown for evaluation, from a single historical event — it does not establish general skill.'
      : 'Live forecasts depend on Open-Meteo NWP availability; when it is unreachable the model falls back to persistence + climatology and the band widens.',
  ];
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg-muted marker:text-accent">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

export function DayLink({ day, horizonDay, selected, href, severityCount }: { day: string; horizonDay: number; selected: boolean; href: string; severityCount: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? 'date' : undefined}
      className={cn(
        'flex min-w-[5.5rem] flex-col rounded-xl border px-3 py-2 text-left transition',
        selected ? 'border-accent bg-accent text-accent-fg shadow-md' : 'border-line hover:border-accent/40 hover:bg-accent-soft',
      )}
    >
      <span className={cn('text-[11px] tabular', selected ? 'opacity-85' : 'text-fg-subtle')}>D+{horizonDay}</span>
      <span className="text-sm font-semibold">{shortDay(day)}</span>
      <span className={cn('text-[11px]', selected ? 'opacity-85' : 'text-fg-muted')}>
        {severityCount > 0 ? `${severityCount} ≥ High` : 'none ≥ High'}
      </span>
    </Link>
  );
}

export function SeverityText({ severity }: { severity: Severity }) {
  return <span>{SEVERITY_META[severity].description}</span>;
}

export function ViewAllLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
      {children} <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}
