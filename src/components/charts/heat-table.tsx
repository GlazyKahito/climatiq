import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './viz.css';

/** Cap the colour ramp so cell text (theme ink) keeps ≥ 4.5:1 contrast at every intensity, in both themes. */
const MAX_MIX = 58;

export type HeatCell = { value: number | null; display: string; detail: string };
export type HeatRow = { key: string; label: ReactNode; text: string; sublabel?: ReactNode; highlight?: boolean; cells: Record<string, HeatCell | undefined> };

const STEPS = 7;

/**
 * Heat table: a real <table> whose cells are shaded with a single-hue sequential ramp (light → dark in light mode,
 * dark → bright in dark mode). Values are printed in every cell, so colour is never the only channel.
 */
export function HeatTable({
  caption,
  rowHeader,
  columns,
  rows,
  min,
  max,
  scaleLabel,
  formatTick = (v) => String(Math.round(v)),
  provenance,
  footnote,
  zeroNeutral = false,
}: {
  /** Leave zero-valued cells unshaded so non-zero counts stand out. */
  zeroNeutral?: boolean;
  caption: string;
  rowHeader: string;
  columns: { key: string; label: ReactNode; note?: string }[];
  rows: HeatRow[];
  min: number;
  max: number;
  scaleLabel: string;
  formatTick?: (v: number) => string;
  provenance?: ReactNode;
  footnote?: ReactNode;
}) {
  const span = max - min || 1;
  const step = (v: number) => Math.max(0, Math.min(STEPS - 1, Math.floor(((v - min) / span) * STEPS)));
  const pct = (s: number) => 6 + Math.round((s / (STEPS - 1)) * 84);
  return (
    <div className="cq-viz flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted" aria-hidden>
        <span>{scaleLabel}</span>
        <span className="flex overflow-hidden rounded">
          {Array.from({ length: STEPS }, (_, s) => (
            <span key={s} className="h-3 w-6" style={{ background: `color-mix(in oklab, var(--viz-seq) ${(pct(s) * MAX_MIX) / 100}%, var(--viz-surface))` }} />
          ))}
        </span>
        <span className="tabular">
          {formatTick(min)} → {formatTick(max)}
        </span>
      </div>
      <div className="relative overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full border-separate border-spacing-[2px] text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] bg-bg-elevated px-2 py-1.5 text-left font-semibold text-fg-muted">
                {rowHeader}
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-1.5 py-1.5 text-center font-semibold text-fg-muted" title={c.note}>
                  {c.label}
                  {c.note && <span className="text-accent">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className={cn('sticky left-0 z-[1] whitespace-nowrap bg-bg-elevated px-2 py-1 text-left font-medium', r.highlight ? 'text-accent' : 'text-fg')}>
                  {r.label}
                  {r.sublabel && <span className="block text-[10px] font-normal text-fg-subtle">{r.sublabel}</span>}
                </th>
                {columns.map((c) => {
                  const cell = r.cells[c.key];
                  if (!cell || cell.value == null || (zeroNeutral && cell.value === 0))
                    return (
                      <td key={c.key} className="min-w-11 rounded px-1.5 py-1 text-center text-fg-subtle tabular" title={cell?.detail ?? 'No data'}>
                        {cell?.display ?? '·'}
                      </td>
                    );
                  const s = step(cell.value);
                  const p = pct(s);
                  return (
                    <td
                      key={c.key}
                      title={cell.detail}
                      className="min-w-11 rounded px-1.5 py-1 text-center font-semibold tabular"
                      style={{ background: `color-mix(in oklab, var(--viz-seq) ${(p * MAX_MIX) / 100}%, var(--viz-surface))`, color: 'var(--viz-ink)' }}
                    >
                      {cell.display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(provenance || footnote) && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
          {provenance && <div className="flex flex-wrap items-center gap-1.5">{provenance}</div>}
          {footnote && <div className="text-[11px] leading-relaxed text-fg-subtle">{footnote}</div>}
        </div>
      )}
    </div>
  );
}
