'use client';

import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Severity } from '@/lib/domain';
import { SeverityBadge } from '@/components/ui/badges';
import { shortDay } from '@/components/charts/format';

export type Factor = { key: string; label: string; value: string; impact: string; detail: string };
export type FactorDay = { day: string; horizonDay: number; severity: Severity; factors: Factor[] };

const IMPACT = {
  raises: { icon: ArrowUpRight, label: 'Raises heat risk', cls: 'text-[var(--sev-high-fg)]' },
  lowers: { icon: ArrowDownRight, label: 'Lowers heat risk', cls: 'text-[var(--sev-low-fg)]' },
  neutral: { icon: Minus, label: 'Neutral / informational', cls: 'text-fg-subtle' },
} as const;

/** Contributing factors stored with each forecast (`forecasts.factors`), browsable by forecast day. */
export function FactorsByDay({ days, initialDay }: { days: FactorDay[]; initialDay: string }) {
  const [day, setDay] = useState(initialDay);
  const current = days.find((d) => d.day === day) ?? days[0];
  if (!current) return <p className="text-sm text-fg-muted">No factors recorded.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Forecast day" className="flex gap-1 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.day}
            role="tab"
            type="button"
            aria-selected={d.day === current.day}
            onClick={() => setDay(d.day)}
            className={cn(
              'shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition',
              d.day === current.day ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-accent-soft hover:text-fg',
            )}
          >
            {shortDay(d.day)}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`Factors for ${shortDay(current.day)}`} className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          D+{current.horizonDay} · <SeverityBadge severity={current.severity} size="sm" />
        </div>
        <ul className="flex flex-col gap-2">
          {current.factors.map((f) => {
            const m = IMPACT[(f.impact as keyof typeof IMPACT) in IMPACT ? (f.impact as keyof typeof IMPACT) : 'neutral'];
            const Icon = m.icon;
            return (
              <li key={f.key} className="flex gap-2.5 rounded-xl border border-line px-3 py-2">
                <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-accent-soft', m.cls)} title={m.label}>
                  <Icon className="size-3.5" aria-hidden />
                  <span className="sr-only">{m.label}</span>
                </span>
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold">{f.label}</span>
                    <span className="text-fg-muted"> · {f.value}</span>
                  </p>
                  <p className="text-xs text-fg-muted">{f.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="flex flex-wrap gap-3 text-[11px] text-fg-subtle">
          {Object.entries(IMPACT).map(([k, m]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <m.icon className={cn('size-3', m.cls)} aria-hidden /> {m.label}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
