'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SEVERITIES, SEVERITY_META, type Confidence, type Severity } from '@/lib/domain';
import { ConfidenceBadge, SeverityBadge } from '@/components/ui/badges';
import { Input, Select } from '@/components/ui/primitives';
import { signed, t1 } from '@/components/charts/format';

export type RegionsTableRow = {
  code: string;
  name: string;
  level: 'country' | 'state' | 'district' | 'city';
  stateCode: string;
  stateName: string;
  predictedTmaxC: number;
  lowerC: number;
  upperC: number;
  departureC: number | null;
  severity: Severity;
  peakSeverity: Severity;
  confidence: Confidence;
  confidenceScore: number;
  durationDays: number;
};

type SortKey = 'name' | 'state' | 'severity' | 'tmax' | 'departure' | 'confidence' | 'peak';
type SortState = { key: SortKey; dir: 'asc' | 'desc' };

function Th({ k, sort, onSort, children, className }: { k: SortKey; sort: SortState; onSort: (k: SortKey) => void; children: React.ReactNode; className?: string }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('whitespace-nowrap px-3 py-2 text-left font-semibold', className)}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 rounded hover:text-fg">
        {children}
        <Icon className={cn('size-3', active ? 'text-accent' : 'opacity-50')} aria-hidden />
      </button>
    </th>
  );
}
const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const PAGE = 40;

export function RegionsTable({ rows, dayLabel }: { rows: RegionsTableRow[]; dayLabel: string }) {
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<'all' | 'state' | 'district'>('all');
  const [state, setState] = useState('all');
  const [minSev, setMinSev] = useState<Severity>('low');
  const [minConf, setMinConf] = useState<Confidence>('low');
  const [sort, setSort] = useState<SortState>({ key: 'severity', dir: 'desc' });
  const [limit, setLimit] = useState(PAGE);
  const dq = useDeferredValue(q);

  const states = useMemo(
    () => [...new Map(rows.map((r) => [r.stateCode, r.stateName])).entries()].filter(([c]) => c).sort((a, b) => a[1].localeCompare(b[1])),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = dq.trim().toLowerCase();
    const out = rows.filter(
      (r) =>
        (level === 'all' || r.level === level) &&
        (state === 'all' || r.stateCode === state) &&
        SEVERITY_META[r.severity].rank >= SEVERITY_META[minSev].rank &&
        CONF_RANK[r.confidence] >= CONF_RANK[minConf] &&
        (!term || r.name.toLowerCase().includes(term) || r.code.toLowerCase().includes(term) || r.stateName.toLowerCase().includes(term)),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (r: RegionsTableRow): number | string => {
      switch (sort.key) {
        case 'name':
          return r.name;
        case 'state':
          return r.stateName;
        case 'severity':
          return SEVERITY_META[r.severity].rank * 100 + r.predictedTmaxC;
        case 'peak':
          return SEVERITY_META[r.peakSeverity].rank * 100 + r.predictedTmaxC;
        case 'tmax':
          return r.predictedTmaxC;
        case 'departure':
          return r.departureC ?? -99;
        case 'confidence':
          return r.confidenceScore;
      }
    };
    return out.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)) * dir || a.name.localeCompare(b.name);
    });
  }, [rows, dq, level, state, minSev, minConf, sort]);

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'state' ? 'asc' : 'desc' }));

  const shown = filtered.slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(12rem,1.4fr)_repeat(4,minmax(0,1fr))]" role="group" aria-label="Filter regions">
        <label className="relative col-span-2 sm:col-span-3 lg:col-span-1">
          <span className="sr-only">Search regions</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search region or state" className="pl-9" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-fg-muted">
          Level
          <Select value={level} onChange={(e) => { setLevel(e.target.value as typeof level); setLimit(PAGE); }}>
            <option value="all">States + districts</option>
            <option value="state">States / UTs</option>
            <option value="district">Pilot districts</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-fg-muted">
          State
          <Select value={state} onChange={(e) => { setState(e.target.value); setLimit(PAGE); }}>
            <option value="all">All states</option>
            {states.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-fg-muted">
          Severity (min)
          <Select value={minSev} onChange={(e) => { setMinSev(e.target.value as Severity); setLimit(PAGE); }}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s === 'low' ? 'Any severity' : `${SEVERITY_META[s].label} or above`}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-fg-muted">
          Confidence (min)
          <Select value={minConf} onChange={(e) => { setMinConf(e.target.value as Confidence); setLimit(PAGE); }}>
            <option value="low">Any confidence</option>
            <option value="medium">Medium or high</option>
            <option value="high">High only</option>
          </Select>
        </label>
      </div>

      <p className="text-xs text-fg-muted" aria-live="polite">
        {filtered.length} of {rows.length} regions · {dayLabel}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-fg-muted">No regions match these filters.</p>
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label="Regional forecasts table">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <caption className="sr-only">Regional forecasts for {dayLabel}. Column headers are sortable.</caption>
            <thead className="bg-accent-soft text-xs text-fg-muted">
              <tr>
                <Th k="name" sort={sort} onSort={toggle} className="sticky left-0 z-[1] bg-[color-mix(in_srgb,var(--bg-elevated)_92%,var(--accent))]">Region</Th>
                <Th k="state" sort={sort} onSort={toggle}>State</Th>
                <Th k="severity" sort={sort} onSort={toggle}>Severity</Th>
                <Th k="tmax" sort={sort} onSort={toggle} className="text-right">Tmax (band)</Th>
                <Th k="departure" sort={sort} onSort={toggle} className="text-right">Departure</Th>
                <Th k="confidence" sort={sort} onSort={toggle}>Confidence</Th>
                <Th k="peak" sort={sort} onSort={toggle}>Horizon peak</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.code} className="border-t border-line hover:bg-accent-soft/60">
                  <th scope="row" className="sticky left-0 z-[1] bg-bg-elevated px-3 py-2 text-left font-medium">
                    <Link href={`/forecasts/${r.code}`} className="hover:text-accent hover:underline">
                      {r.name}
                    </Link>
                    <span className="block text-[11px] font-normal capitalize text-fg-subtle">{r.level === 'state' ? 'State / UT' : r.level}</span>
                  </th>
                  <td className="px-3 py-2 text-fg-muted">{r.level === 'state' ? '—' : r.stateName}</td>
                  <td className="px-3 py-2">
                    <SeverityBadge severity={r.severity} size="sm" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular">
                    <span className="font-semibold">{t1(r.predictedTmaxC)}</span>
                    <span className="block text-[11px] text-fg-subtle">
                      {r.lowerC.toFixed(1)}–{r.upperC.toFixed(1)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular text-fg-muted">{signed(r.departureC)}</td>
                  <td className="px-3 py-2">
                    <ConfidenceBadge confidence={r.confidence} score={r.confidenceScore} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <SeverityBadge severity={r.peakSeverity} size="sm" />
                      {r.durationDays > 0 && <span className="text-[11px] text-fg-subtle">{r.durationDays} d ≥ High</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + 80)} className="self-center rounded-xl border border-line px-4 py-2 text-sm text-fg-muted hover:bg-accent-soft hover:text-fg">
          Show more ({filtered.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
