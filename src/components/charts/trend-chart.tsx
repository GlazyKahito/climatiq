'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';
import { ChartFrame, Legend, TooltipCard } from './chart-frame';
import { monthYear, niceScale, shortDay, t1 } from './format';

/**
 * Compact daily series: `v[i]` / `m[i]` are the daily Tmax and 30-day rolling mean for day `start + i` (null = no data,
 * so seasonal gaps break the line instead of being bridged).
 */
export type TrendSeries = {
  code: string;
  name: string;
  slot: number;
  note?: string;
  start: string;
  v: (number | null)[];
  m: (number | null)[];
  annual: { year: number; days: number; mean: number | null; max: number | null }[];
};

const DAY = 86_400_000;

function expand(s: TrendSeries) {
  const t0 = Date.parse(`${s.start}T00:00:00Z`);
  return s.v.map((v, i) => {
    const t = t0 + i * DAY;
    return { t, d: new Date(t).toISOString().slice(0, 10), v, m: s.m[i] ?? null };
  });
}

function yearTicks(from: number, to: number) {
  const ticks: number[] = [];
  const start = new Date(from);
  const span = (to - from) / DAY;
  const stepMonths = span > 1500 ? 12 : span > 700 ? 6 : span > 200 ? 3 : 1;
  let y = start.getUTCFullYear();
  let m = Math.ceil(start.getUTCMonth() / stepMonths) * stepMonths;
  for (;;) {
    if (m >= 12) {
      y += Math.floor(m / 12);
      m %= 12;
    }
    const t = Date.UTC(y, m, 1);
    if (t > to) break;
    if (t >= from) ticks.push(t);
    m += stepMonths;
  }
  return ticks;
}

/**
 * Historical temperature trends as small multiples (one panel per region, shared axes): faint daily Tmax with the
 * 30-day rolling mean in the region's series colour.
 */
export function TrendSmallMultiples({ series, from, to, provenance, footnote }: { series: TrendSeries[]; from: string; to: string; provenance?: ReactNode; footnote?: ReactNode }) {
  const t0 = Date.parse(`${from}T00:00:00Z`);
  const t1d = Date.parse(`${to}T00:00:00Z`);
  const { domain, ticks: yTicks } = niceScale(series.flatMap((s) => s.v), 1);
  const ticks = yearTicks(t0, t1d);
  const summary = series
    .map((s) => {
      const last = s.annual.at(-1);
      return `${s.name}: ${s.v.filter((x) => x != null).length} days of data${last ? `, ${last.year} mean ${t1(last.mean)} and max ${t1(last.max)}` : ''}`;
    })
    .join('; ');
  return (
    <ChartFrame
      summary={`Daily maximum temperature and 30-day rolling mean, ${shortDay(from)} ${from.slice(0, 4)} to ${shortDay(to)} ${to.slice(0, 4)}. ${summary}.`}
      provenance={provenance}
      footnote={footnote}
      table={{
        caption: 'Annual summary of daily Tmax by region',
        columns: ['Region · year', 'Days with data', 'Mean Tmax (°C)', 'Max Tmax (°C)'],
        rows: series.flatMap((s) => s.annual.map((a) => [`${s.name} · ${a.year}`, a.days, a.mean, a.max])),
        numeric: [1, 2, 3],
      }}
      legend={
        <Legend>
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <svg width="18" height="10" aria-hidden>
              <line x1="1" y1="5" x2="17" y2="5" stroke="var(--viz-ink-2)" strokeOpacity="0.4" strokeWidth="1" />
            </svg>
            Daily Tmax
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <svg width="18" height="10" aria-hidden>
              <line x1="1" y1="5" x2="17" y2="5" stroke="var(--viz-ink-2)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            30-day rolling mean (shown when ≥ 20 of 30 days have data)
          </span>
        </Legend>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {series.map((s) => {
          const data = expand(s);
          const hasData = s.v.some((x) => x != null);
          const color = `var(--viz-${s.slot + 1})`;
          return (
            <div key={s.code} className="min-w-0 rounded-xl border border-line px-2 pb-1 pt-2.5">
              <p className="flex items-center gap-2 px-2 text-xs font-semibold text-fg">
                <svg width="14" height="8" aria-hidden>
                  <line x1="0" y1="4" x2="14" y2="4" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                {s.name}
                {s.note && <span className="font-normal text-fg-subtle">· {s.note}</span>}
              </p>
              {!hasData ? (
                <p className="px-2 py-10 text-center text-xs text-fg-muted">No daily history in this range.</p>
              ) : (
                <div className="h-[190px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="t" type="number" scale="time" domain={[t0, t1d]} ticks={ticks} tickFormatter={(t: number) => monthYear(new Date(t).toISOString().slice(0, 10))} tickLine={false} minTickGap={14} tickMargin={6} />
                      <YAxis domain={domain} ticks={yTicks} tickLine={false} axisLine={false} width={46} allowDecimals={false} tickFormatter={(v: number) => `${v}°`} />
                      <Line dataKey="v" stroke={color} strokeOpacity={0.3} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
                      <Line dataKey="m" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: color, stroke: 'var(--viz-surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
                      <Tooltip
                        cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
                        isAnimationActive={false}
                        content={({ active, payload }) => {
                          const p = active ? (payload?.[0]?.payload as { d: string; v: number | null; m: number | null } | undefined) : undefined;
                          if (!p || !p.d) return null;
                          return (
                            <TooltipCard
                              title={`${s.name} · ${shortDay(p.d)} ${p.d.slice(0, 4)}`}
                              rows={[
                                { key: 'v', label: 'daily Tmax', value: t1(p.v), color, kind: 'line' },
                                { key: 'm', label: '30-day mean', value: t1(p.m), color, kind: 'line' },
                              ]}
                            />
                          );
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}
