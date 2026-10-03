'use client';

import { useId, useState, type ReactNode } from 'react';
import { Table2, LineChart as LineIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import './viz.css';

export type TableSpec = {
  caption: string;
  columns: string[];
  rows: (string | number | null)[][];
  /** Column indexes rendered right-aligned with tabular figures. */
  numeric?: number[];
};

/**
 * Accessible chart container: the chart is an `role="img"` with a text summary, a "Show data table" toggle exposes
 * the same values as a table (the WCAG-clean twin), and provenance sits under every chart.
 */
export function ChartFrame({
  title,
  description,
  summary,
  legend,
  table,
  provenance,
  footnote,
  children,
  className,
  actions,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** Plain-language summary read by screen readers in place of the SVG. */
  summary: string;
  legend?: ReactNode;
  table?: TableSpec;
  provenance?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  return (
    <figure className={cn('cq-viz flex min-w-0 flex-col gap-3', className)}>
      {(title || description || table || actions) && (
        <figcaption className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {table && (
              <button
                type="button"
                onClick={() => setShowTable((s) => !s)}
                aria-expanded={showTable}
                aria-controls={tableId}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-fg-muted transition hover:bg-accent-soft hover:text-fg"
              >
                {showTable ? <LineIcon className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
                {showTable ? 'Hide data table' : 'Show data table'}
              </button>
            )}
          </div>
        </figcaption>
      )}
      {legend}
      <div role="group" aria-label={summary} className="min-w-0">
        {children}
      </div>
      {table && showTable && (
        <div id={tableId}>
          <DataTable spec={table} />
        </div>
      )}
      {(provenance || footnote) && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
          {provenance && <div className="flex flex-wrap items-center gap-1.5">{provenance}</div>}
          {footnote && <p className="text-[11px] leading-relaxed text-fg-subtle">{footnote}</p>}
        </div>
      )}
    </figure>
  );
}

export function DataTable({ spec, maxHeight = 320 }: { spec: TableSpec; maxHeight?: number }) {
  const numeric = new Set(spec.numeric ?? []);
  return (
    <div className="relative overflow-auto rounded-xl border border-line" style={{ maxHeight }} tabIndex={0} role="region" aria-label={spec.caption}>
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{spec.caption}</caption>
        <thead className="sticky top-0 bg-glass-strong backdrop-blur">
          <tr>
            {spec.columns.map((c, i) => (
              <th key={c} scope="col" className={cn('border-b border-line px-2.5 py-2 text-left font-semibold text-fg-muted', numeric.has(i) && 'text-right')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, ri) => (
            <tr key={ri} className="odd:bg-accent-soft/40">
              {r.map((v, ci) =>
                ci === 0 ? (
                  <th key={ci} scope="row" className="px-2.5 py-1.5 text-left font-medium text-fg">
                    {v ?? '—'}
                  </th>
                ) : (
                  <td key={ci} className={cn('px-2.5 py-1.5 text-fg', numeric.has(ci) && 'text-right tabular')}>
                    {v ?? '—'}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Legend entry: a short line key for lines, a rect for bars/areas, a dot for points, dashed for references. */
export function LegendItem({ label, color, kind = 'line' }: { label: ReactNode; color: string; kind?: 'line' | 'rect' | 'dot' | 'dashed' | 'band' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      <svg width="18" height="10" aria-hidden className="shrink-0">
        {kind === 'line' && <line x1="1" y1="5" x2="17" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />}
        {kind === 'dashed' && <line x1="1" y1="5" x2="17" y2="5" stroke={color} strokeWidth="1.5" strokeDasharray="3 3" />}
        {kind === 'rect' && <rect x="3" y="1" width="12" height="8" rx="2" fill={color} />}
        {kind === 'band' && <rect x="1" y="1" width="16" height="8" rx="2" fill={color} />}
        {kind === 'dot' && <circle cx="9" cy="5" r="4" fill={color} stroke="var(--viz-surface)" strokeWidth="1.5" />}
      </svg>
      {label}
    </span>
  );
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">{children}</div>;
}

/** Shared Recharts tooltip body: values lead (strong), labels follow; line keys, not boxes. */
export function TooltipCard({
  title,
  rows,
  note,
}: {
  title: ReactNode;
  rows: { key: string; label: ReactNode; value: ReactNode; color?: string; kind?: 'line' | 'dot' | 'rect' | 'dashed' }[];
  note?: ReactNode;
}) {
  return (
    <div className="glass-strong pointer-events-none min-w-44 max-w-72 rounded-xl px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-fg">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            {r.color && (
              <svg width="12" height="8" aria-hidden className="shrink-0">
                {r.kind === 'dot' ? (
                  <circle cx="6" cy="4" r="3.5" fill={r.color} />
                ) : r.kind === 'rect' ? (
                  <rect x="1" y="0" width="10" height="8" rx="2" fill={r.color} />
                ) : (
                  <line x1="0" y1="4" x2="12" y2="4" stroke={r.color} strokeWidth="2" strokeDasharray={r.kind === 'dashed' ? '3 2' : undefined} />
                )}
              </svg>
            )}
            <span className="font-semibold tabular text-fg">{r.value}</span>
            <span className="text-fg-muted">{r.label}</span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-fg-subtle">{note}</p>}
    </div>
  );
}
