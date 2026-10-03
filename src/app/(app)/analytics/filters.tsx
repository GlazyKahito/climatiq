'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type Option = { code: string; name: string; level: 'state' | 'district'; stateName: string | null };
type RunOpt = { id: string; label: string };

export type FilterState = {
  slots: (string | null)[];
  from: string;
  to: string;
  scenario: 'live' | 'replay';
  run: string | null;
};

const MAX = 4;

function shiftYears(day: string, years: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * One filter row that scopes every section below it: regions (≤ 4, colours follow the slot so removing a region never
 * repaints the others), date range presets + custom range, reference-normal scenario and verification run.
 */
export function AnalyticsFilters({ options, state, dataFirst, dataLast, runs }: { options: Option[]; state: FilterState; dataFirst: string; dataLast: string; runs: RunOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(state.from);
  const [to, setTo] = useState(state.to);
  const [error, setError] = useState<string | null>(null);

  const byCode = useMemo(() => new Map(options.map((o) => [o.code, o])), [options]);
  const groups = useMemo(() => {
    const states = options.filter((o) => o.level === 'state');
    const districts = new Map<string, Option[]>();
    for (const o of options.filter((x) => x.level === 'district')) {
      const k = o.stateName ?? 'Other';
      districts.set(k, [...(districts.get(k) ?? []), o]);
    }
    return { states, districts: [...districts.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
  }, [options]);

  const navigate = (next: Partial<FilterState>) => {
    const s = { ...state, from, to, ...next };
    if (s.from > s.to) {
      setError('The start date must be on or before the end date.');
      return;
    }
    setError(null);
    const params = new URLSearchParams();
    // Keep empty slots so colours stay attached to their region.
    let slots = [...s.slots];
    while (slots.length && slots.at(-1) == null) slots = slots.slice(0, -1);
    params.set('regions', slots.map((c) => c ?? '').join(','));
    params.set('from', s.from);
    params.set('to', s.to);
    params.set('scenario', s.scenario);
    if (s.run) params.set('run', s.run);
    start(() => router.push(`/analytics?${params.toString()}`, { scroll: false }));
  };

  const add = (code: string) => {
    if (!code || state.slots.includes(code)) return;
    const slots = [...state.slots];
    const hole = slots.findIndex((c) => c == null);
    if (hole >= 0) slots[hole] = code;
    else if (slots.length < MAX) slots.push(code);
    else return;
    navigate({ slots });
  };
  const remove = (code: string) => navigate({ slots: state.slots.map((c) => (c === code ? null : c)) });
  const selectedCount = state.slots.filter(Boolean).length;

  const presets: { label: string; from: string; to: string }[] = [
    { label: 'Last 12 months', from: shiftYears(dataLast, -1), to: dataLast },
    { label: 'Last 2 years', from: shiftYears(dataLast, -2), to: dataLast },
    { label: 'Last 5 years', from: shiftYears(dataLast, -5), to: dataLast },
    { label: 'Pre-monsoon 2024', from: '2024-03-01', to: '2024-06-30' },
    { label: 'All stored data', from: dataFirst, to: dataLast },
  ].map((p) => ({ ...p, from: p.from < dataFirst ? dataFirst : p.from }));

  return (
    <section aria-label="Analytics filters" className={cn('glass flex flex-col gap-4 rounded-[var(--radius-glass)] px-5 py-4', pending && 'opacity-80')}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">Regions (up to {MAX})</h2>
          {pending && (
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted" role="status">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Updating…
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state.slots.map((code, i) =>
            code ? (
              <span key={code} className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-glass-strong py-1 pl-3 pr-1 text-sm">
                <svg width="14" height="8" aria-hidden className="cq-viz">
                  <line x1="0" y1="4" x2="14" y2="4" stroke={`var(--viz-${i + 1})`} strokeWidth="3" strokeLinecap="round" />
                </svg>
                {byCode.get(code)?.name ?? code}
                {byCode.get(code)?.level === 'district' && <span className="text-[11px] text-fg-subtle">district</span>}
                <button type="button" onClick={() => remove(code)} disabled={pending} className="grid size-6 place-items-center rounded-full text-fg-subtle hover:bg-accent-soft hover:text-fg" aria-label={`Remove ${byCode.get(code)?.name ?? code}`}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ) : null,
          )}
          <label className="relative inline-flex w-full items-center sm:w-auto">
            <span className="sr-only">Add a region</span>
            <Plus className="pointer-events-none absolute left-3 size-3.5 text-fg-subtle" aria-hidden />
            <Select value="" disabled={pending || selectedCount >= MAX} onChange={(e) => add(e.target.value)} className="w-full pl-8 sm:w-56">
              <option value="">{selectedCount >= MAX ? 'Limit reached (4)' : 'Add a region…'}</option>
              <optgroup label="States & union territories">
                {groups.states.map((o) => (
                  <option key={o.code} value={o.code} disabled={state.slots.includes(o.code)}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
              {groups.districts.map(([stateName, list]) => (
                <optgroup key={stateName} label={`Districts — ${stateName}`}>
                  {list.map((o) => (
                    <option key={o.code} value={o.code} disabled={state.slots.includes(o.code)}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">Date range</h2>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const active = p.from === state.from && p.to === state.to;
            return (
              <button
                key={p.label}
                type="button"
                disabled={pending}
                aria-pressed={active}
                onClick={() => {
                  setFrom(p.from);
                  setTo(p.to);
                  navigate({ from: p.from, to: p.to });
                }}
                className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium transition', active ? 'border-accent bg-accent text-accent-fg' : 'border-line text-fg-muted hover:bg-accent-soft hover:text-fg')}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({});
          }}
        >
          <label className="flex w-full flex-col gap-1 text-[11px] font-semibold text-fg-muted sm:w-auto">
            From
            <Input type="date" value={from} min={dataFirst} max={dataLast} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-40" required />
          </label>
          <label className="flex w-full flex-col gap-1 text-[11px] font-semibold text-fg-muted sm:w-auto">
            To
            <Input type="date" value={to} min={dataFirst} max={dataLast} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-40" required />
          </label>
          <label className="flex w-full flex-col gap-1 text-[11px] font-semibold text-fg-muted sm:w-auto">
            Reference normal
            <Select value={state.scenario} onChange={(e) => navigate({ scenario: e.target.value as 'live' | 'replay' })} disabled={pending} className="w-full sm:w-60">
              <option value="replay">ERA5 2019–2023 (replay basis)</option>
              <option value="live">ERA5 2021–2025 (live basis)</option>
            </Select>
          </label>
          {runs.length > 0 && (
            <label className="flex w-full flex-col gap-1 text-[11px] font-semibold text-fg-muted sm:w-auto">
              Verification run
              <Select value={state.run ?? ''} onChange={(e) => navigate({ run: e.target.value || null })} disabled={pending} className="w-full sm:w-64">
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            Apply dates
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-xs font-medium text-accent">
            {error}
          </p>
        )}
        <p className="text-[11px] text-fg-subtle">
          Stored daily history: {dataFirst} → {dataLast}. States are continuous from Oct 2021 (spring windows in 2019–2020); districts have seasonal windows only (20 Apr–30 Jun 2019–2025,
          1 Sep–15 Nov 2022–2025, Aug–Sep 2026).
        </p>
      </div>
    </section>
  );
}
