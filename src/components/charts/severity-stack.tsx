'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SEVERITIES, SEVERITY_META, type Severity } from '@/lib/domain';
import { SeverityBadge } from '@/components/ui/badges';
import { ChartFrame, type TableSpec } from './chart-frame';

export type StackRow = {
  key: string;
  label: ReactNode;
  /** Plain-text label for tables / aria. */
  text: string;
  sublabel?: ReactNode;
  href?: string;
  selected?: boolean;
  counts: Record<Severity, number>;
};

/**
 * Horizontal 100 % stacked bars of severity counts (one row per forecast day or per run).
 * Fixed order low → extreme left to right, 2 px surface gaps between segments, counts inside segments only when
 * they fit, legend with icon + label, per-segment hover/focus tooltip and a table twin.
 */
export function SeverityStack({
  rows,
  title,
  description,
  unit = 'regions',
  provenance,
  footnote,
  emptyText = 'No forecasts in this run.',
  countNoun = 'region-days in total',
}: {
  rows: StackRow[];
  title?: ReactNode;
  description?: ReactNode;
  unit?: string;
  provenance?: ReactNode;
  footnote?: ReactNode;
  emptyText?: string;
  /** What one counted item is, for the summary line (e.g. 'region-days' for per-day rows, 'regions' for peaks). */
  countNoun?: string;
}) {
  const table: TableSpec = {
    caption: `Severity counts (${unit})`,
    columns: ['Row', ...SEVERITIES.map((s) => SEVERITY_META[s].label), 'Total'],
    rows: rows.map((r) => [r.text, ...SEVERITIES.map((s) => r.counts[s]), SEVERITIES.reduce((a, s) => a + r.counts[s], 0)]),
    numeric: [1, 2, 3, 4, 5],
  };
  const atRisk = rows.reduce((a, r) => a + r.counts.high + r.counts.extreme, 0);
  const summary = rows.length
    ? `Stacked bars of ${unit} by CLIMATIQ severity for ${rows.length} rows. ${rows
        .map((r) => `${r.text}: ${SEVERITIES.map((s) => `${r.counts[s]} ${SEVERITY_META[s].label}`).join(', ')}`)
        .join('; ')}.`
    : emptyText;

  return (
    <ChartFrame
      title={title}
      description={description}
      summary={summary}
      table={rows.length ? table : undefined}
      provenance={provenance}
      footnote={footnote}
      legend={
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Severity legend">
          {SEVERITIES.map((s) => (
            <SeverityBadge key={s} severity={s} size="sm" />
          ))}
          <span className="ml-1 text-[11px] text-fg-subtle">
            {atRisk > 0 ? `${atRisk} ${countNoun} at High or Extreme` : `No ${unit} at High or Extreme`}
          </span>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <StackBar key={r.key} row={r} unit={unit} />
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}

function StackBar({ row, unit }: { row: StackRow; unit: string }) {
  const total = SEVERITIES.reduce((a, s) => a + row.counts[s], 0);
  const atRisk = row.counts.high + row.counts.extreme;
  const label = (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className={cn('truncate text-xs font-semibold', row.selected ? 'text-accent' : 'text-fg')}>{row.label}</span>
      {row.sublabel && <span className="truncate text-[11px] text-fg-subtle">{row.sublabel}</span>}
    </span>
  );
  return (
    <li
      className={cn(
        'grid grid-cols-[5rem_1fr_4rem] items-center gap-2 rounded-lg px-1.5 py-1 sm:grid-cols-[8.5rem_1fr_4.5rem]',
        row.selected && 'bg-accent-soft ring-1 ring-accent/30',
      )}
    >
      {row.href ? (
        <Link href={row.href} scroll={false} aria-current={row.selected ? 'true' : undefined} className="min-w-0 rounded-md hover:underline">
          {label}
        </Link>
      ) : (
        label
      )}
      <div className="flex h-6 min-w-0 gap-[2px] overflow-visible" aria-hidden={total === 0}>
        {total === 0 ? (
          <span className="h-full w-full rounded bg-accent-soft" />
        ) : (
          SEVERITIES.filter((s) => row.counts[s] > 0).map((s, i, arr) => {
            const share = row.counts[s] / total;
            const first = i === 0;
            const last = i === arr.length - 1;
            return (
              <span
                key={s}
                tabIndex={0}
                role="img"
                aria-label={`${row.text}: ${row.counts[s]} ${unit} ${SEVERITY_META[s].label} (${Math.round(share * 100)} %)`}
                className={cn(
                  'sev-seg group relative flex h-full min-w-[3px] items-center justify-center outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--focus)]',
                  `sev-seg-${s}`,
                  first && 'rounded-l',
                  last && 'rounded-r',
                )}
                style={{ flexGrow: row.counts[s], flexBasis: 0, background: `var(--sev-${s})`, color: `var(--sev-${s}-ink)` }}
              >
                {share >= 0.12 && <span className="pointer-events-none text-[11px] font-semibold tabular">{row.counts[s]}</span>}
                <span
                  role="tooltip"
                  className="glass-strong pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] text-fg shadow-lg group-hover:block group-focus-visible:block"
                >
                  <strong className="tabular">{row.counts[s]}</strong> {unit} · {SEVERITY_META[s].label} · {Math.round(share * 100)} %
                </span>
              </span>
            );
          })
        )}
      </div>
      <span className="text-right text-[11px] leading-tight text-fg-muted">
        <span className="font-semibold tabular text-fg">{atRisk}</span> ≥ High
        <span className="block text-fg-subtle tabular">of {total}</span>
      </span>
    </li>
  );
}
