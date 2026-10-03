'use client';

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';
import { ChartFrame, Legend, LegendItem, TooltipCard } from './chart-frame';
import { signed } from './format';

export type HorizonStat = { horizonDay: number; n: number; mae: number; rmse: number; bias: number };

/** MAE and RMSE by lead time (grouped columns, one °C axis) plus bias by lead time (diverging columns, own chart). */
export function HorizonErrorCharts({ stats, provenance, footnote }: { stats: HorizonStat[]; provenance?: ReactNode; footnote?: ReactNode }) {
  const data = stats.map((s) => ({ ...s, label: `D+${s.horizonDay}` }));
  const maxErr = Math.ceil(Math.max(1, ...stats.map((s) => s.rmse)) + 0.3);
  const errStep = maxErr > 4 ? 1 : 0.5;
  const errTicks = Array.from({ length: Math.round(maxErr / errStep) + 1 }, (_, i) => i * errStep);
  const maxBias = Math.max(0.5, ...stats.map((s) => Math.abs(s.bias)));
  const biasDomain: [number, number] = [-Math.ceil(maxBias * 2) / 2, Math.ceil(maxBias * 2) / 2];
  const table = {
    caption: 'Error statistics by forecast lead time',
    columns: ['Lead time', 'Samples (n)', 'MAE (°C)', 'RMSE (°C)', 'Bias (°C, predicted − truth)'],
    rows: stats.map((s) => [`D+${s.horizonDay}`, s.n, s.mae, s.rmse, s.bias]),
    numeric: [1, 2, 3, 4],
  };
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      <ChartFrame
        className="lg:col-span-3"
        title="Error by lead time"
        description="Mean absolute error and root-mean-square error, °C (lower is better)"
        summary={`MAE and RMSE by lead time: ${stats.map((s) => `D+${s.horizonDay} MAE ${s.mae} °C, RMSE ${s.rmse} °C (n=${s.n})`).join('; ')}.`}
        table={table}
        provenance={provenance}
        footnote={footnote}
        legend={
          <Legend>
            <LegendItem label="MAE" color="var(--viz-1)" kind="rect" />
            <LegendItem label="RMSE" color="var(--viz-2)" kind="rect" />
          </Legend>
        }
      >
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={6} />
              <YAxis domain={[0, maxErr]} ticks={errTicks} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}°`} />
              <Bar dataKey="mae" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
                <LabelList dataKey="mae" position="top" offset={4} formatter={(v: unknown) => (typeof v === 'number' ? v.toFixed(1) : '')} className="fill-[var(--viz-ink-2)] text-[10px]" />
              </Bar>
              <Bar dataKey="rmse" fill="var(--viz-2)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              <Tooltip
                cursor={{ fill: 'var(--accent-soft)' }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const p = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                  if (!p) return null;
                  return (
                    <TooltipCard
                      title={`${p.label} · n = ${p.n}`}
                      rows={[
                        { key: 'mae', label: 'MAE', value: `${p.mae.toFixed(2)} °C`, color: 'var(--viz-1)', kind: 'rect' },
                        { key: 'rmse', label: 'RMSE', value: `${p.rmse.toFixed(2)} °C`, color: 'var(--viz-2)', kind: 'rect' },
                        { key: 'bias', label: 'bias', value: signed(p.bias, 2) },
                      ]}
                    />
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartFrame>
      <ChartFrame
        className="lg:col-span-2"
        title="Bias by lead time"
        description="Mean of predicted − truth, °C · above 0 = forecast too warm"
        summary={`Bias by lead time: ${stats.map((s) => `D+${s.horizonDay} ${signed(s.bias, 2)}`).join('; ')}.`}
        legend={
          <Legend>
            <LegendItem label="Too warm" color="var(--viz-warm)" kind="rect" />
            <LegendItem label="Too cold" color="var(--viz-cool)" kind="rect" />
          </Legend>
        }
      >
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={6} />
              <YAxis domain={biasDomain} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}°`} />
              <ReferenceLine y={0} stroke="var(--viz-axis)" />
              <Bar dataKey="bias" maxBarSize={24} isAnimationActive={false} radius={4}>
                {data.map((d) => (
                  <Cell key={d.label} fill={d.bias >= 0 ? 'var(--viz-warm)' : 'var(--viz-cool)'} />
                ))}
                <LabelList dataKey="bias" position="top" offset={4} formatter={(v: unknown) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : '')} className="fill-[var(--viz-ink-2)] text-[10px]" />
              </Bar>
              <Tooltip
                cursor={{ fill: 'var(--accent-soft)' }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const p = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                  if (!p) return null;
                  return (
                    <TooltipCard
                      title={`${p.label} · n = ${p.n}`}
                      rows={[{ key: 'b', label: p.bias >= 0 ? 'forecast too warm' : 'forecast too cold', value: signed(p.bias, 2), color: p.bias >= 0 ? 'var(--viz-warm)' : 'var(--viz-cool)', kind: 'rect' }]}
                    />
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartFrame>
    </div>
  );
}
