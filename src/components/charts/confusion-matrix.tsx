import { SEVERITIES, SEVERITY_META } from '@/lib/domain';
import { SeverityBadge } from '@/components/ui/badges';
import './viz.css';

/**
 * Severity hit/miss table: rows = predicted CLIMATIQ severity, columns = severity of the truth (reanalysis Tmax
 * classified with the same rule). The diagonal holds exact matches. Counts are printed; shading is supplementary.
 */
export function ConfusionMatrix({ matrix, n }: { matrix: number[][]; n: number }) {
  const max = Math.max(1, ...matrix.flat());
  const colTotals = SEVERITIES.map((_, j) => matrix.reduce((a, row) => a + row[j], 0));
  return (
    <div className="cq-viz relative overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label="Severity confusion matrix">
      <table className="w-full min-w-[520px] border-separate border-spacing-[2px] text-xs">
        <caption className="sr-only">Predicted severity (rows) versus severity from reanalysis truth (columns), {n} samples.</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1.5 text-left font-semibold text-fg-muted">
              Predicted ↓ · Truth →
            </th>
            {SEVERITIES.map((s) => (
              <th key={s} scope="col" className="px-1 py-1.5 text-center">
                <SeverityBadge severity={s} size="sm" />
              </th>
            ))}
            <th scope="col" className="px-2 py-1.5 text-right font-semibold text-fg-muted">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {SEVERITIES.map((p, i) => {
            const rowTotal = matrix[i].reduce((a, b) => a + b, 0);
            return (
              <tr key={p}>
                <th scope="row" className="px-2 py-1 text-left">
                  <SeverityBadge severity={p} size="sm" />
                </th>
                {SEVERITIES.map((o, j) => {
                  const v = matrix[i][j];
                  const pct = v === 0 ? 0 : 8 + Math.round((v / max) * 80);
                  const diag = i === j;
                  return (
                    <td
                      key={o}
                      className="rounded px-2 py-2 text-center font-semibold tabular"
                      style={{
                        background: v ? `color-mix(in oklab, var(--viz-seq) ${pct}%, var(--viz-surface))` : undefined,
                        color: pct >= 55 ? 'var(--viz-on-strong)' : v ? 'var(--viz-ink)' : 'var(--viz-muted)',
                        outline: diag ? '1.5px solid var(--viz-ink-2)' : undefined,
                        outlineOffset: -1,
                      }}
                      title={`Predicted ${SEVERITY_META[p].label}, truth ${SEVERITY_META[o].label}: ${v} (${n ? Math.round((v / n) * 100) : 0} % of samples)${diag ? ' — exact match' : ''}`}
                    >
                      {v}
                      {diag && <span className="sr-only"> (exact match)</span>}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-right tabular text-fg-muted">{rowTotal}</td>
              </tr>
            );
          })}
          <tr>
            <th scope="row" className="px-2 py-1 text-left font-semibold text-fg-muted">
              Total
            </th>
            {colTotals.map((v, j) => (
              <td key={j} className="px-2 py-1 text-center tabular text-fg-muted">
                {v}
              </td>
            ))}
            <td className="px-2 py-1 text-right font-semibold tabular">{n}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
