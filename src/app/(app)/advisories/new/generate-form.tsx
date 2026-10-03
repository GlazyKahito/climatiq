'use client';

import { useMemo, useState, useTransition } from 'react';
import { Check, Loader2, RotateCcw, Save, Search, Sparkles, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Button, Panel, Skeleton } from '@/components/ui/primitives';
import { OriginTag, SeverityBadge } from '@/components/ui/badges';
import { AudienceBadge, ScenarioBadge } from '@/components/advisories/badges';
import { AdvisoryContentView } from '@/components/advisories/advisory-content';
import { BundleInspector, ProvenanceList, SourceRefs } from '@/components/advisories/provenance';
import { cn } from '@/lib/utils';
import { fmtDate, SEVERITY_META, type Audience, type Severity } from '@/lib/domain';
import type { AdvisoryPreview } from '@/server/advisories/service';
import { previewAdvisoryAction, saveAdvisoryDraftAction } from '../actions';

export type RegionOption = { code: string; name: string; level: 'state' | 'district'; stateName: string; severity: Severity; maxTmax: number };
const MAX = 12;

export function GenerateForm({
  options,
  initial,
  providerLabel,
  userName,
  audiences,
}: {
  options: RegionOption[];
  initial: string[];
  providerLabel: string;
  userName: string;
  audiences: { key: Audience; label: string; brief: string }[];
}) {
  const reduce = useReducedMotion();
  const [selected, setSelected] = useState<string[]>(initial);
  const [audience, setAudience] = useState<Audience>('disaster_mgmt');
  const [q, setQ] = useState('');
  const [hotOnly, setHotOnly] = useState(initial.length === 0);
  const [result, setResult] = useState<{ preview: AdvisoryPreview; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, startGen] = useTransition();
  const [saving, startSave] = useTransition();

  const byCode = useMemo(() => new Map(options.map((o) => [o.code, o])), [options]);
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rank = (s: Severity) => SEVERITY_META[s].rank;
    const filtered = options.filter(
      (o) => (!hotOnly || rank(o.severity) >= rank('high') || selected.includes(o.code)) && (!term || o.name.toLowerCase().includes(term) || o.stateName.toLowerCase().includes(term) || o.code.toLowerCase().includes(term)),
    );
    const map = new Map<string, RegionOption[]>();
    for (const o of filtered) map.set(o.stateName, [...(map.get(o.stateName) ?? []), o]);
    return [...map.entries()]
      .map(([state, list]) => ({
        state,
        list: list.sort((a, b) => (a.level === 'state' ? -1 : b.level === 'state' ? 1 : rank(b.severity) - rank(a.severity) || b.maxTmax - a.maxTmax)),
        peak: Math.max(...list.map((o) => rank(o.severity))),
      }))
      .sort((a, b) => b.peak - a.peak || a.state.localeCompare(b.state));
  }, [options, q, hotOnly, selected]);

  const toggle = (code: string) => {
    setResult(null);
    setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : s.length >= MAX ? s : [...s, code]));
  };

  const generate = () => {
    setError(null);
    startGen(async () => {
      const res = await previewAdvisoryAction({ regionCodes: selected, audience });
      if (res.ok && res.data) setResult(res.data);
      else if (!res.ok) setError(res.error);
    });
  };

  const save = () => {
    if (!result) return;
    setError(null);
    startSave(async () => {
      const res = await saveAdvisoryDraftAction(result.token);
      if (res && !res.ok) setError(res.error);
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Panel title="1 · Regions" description={`Choose up to ${MAX}. Peak CLIMATIQ severity over the advisory window is shown.`}>
          <div className="flex flex-col gap-3">
            {selected.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Selected regions">
                {selected.map((c) => {
                  const o = byCode.get(c);
                  return (
                    <li key={c}>
                      <button
                        type="button"
                        onClick={() => toggle(c)}
                        className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/15"
                        aria-label={`Remove ${o?.name ?? c}`}
                      >
                        {o?.name ?? c} <X aria-hidden className="size-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex flex-1 items-center gap-2 rounded-xl border border-line-strong bg-glass-strong px-2.5 focus-within:border-accent">
                <Search aria-hidden className="size-4 text-fg-subtle" />
                <span className="sr-only">Filter regions</span>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter states or districts…" className="h-9 w-full bg-transparent text-sm outline-none" />
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <input type="checkbox" checked={hotOnly} onChange={(e) => setHotOnly(e.target.checked)} className="accent-[var(--accent)]" />
                High &amp; Extreme only
              </label>
            </div>
            <div className="relative max-h-[26rem] overflow-y-auto overscroll-contain rounded-xl border border-line" role="group" aria-label="Regions">
              {groups.length === 0 && <p className="px-3 py-6 text-center text-sm text-fg-muted">No regions match.</p>}
              {groups.map((g) => (
                <fieldset key={g.state} className="border-b border-line last:border-0">
                  <legend className="sr-only">{g.state}</legend>
                  <p className="sticky top-0 z-10 bg-glass-strong px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle backdrop-blur">{g.state}</p>
                  <ul>
                    {g.list.map((o) => {
                      const on = selected.includes(o.code);
                      const disabled = !on && selected.length >= MAX;
                      return (
                        <li key={o.code}>
                          <label className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent-soft', on && 'bg-accent-soft', disabled && 'cursor-not-allowed opacity-50')}>
                            <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(o.code)} className="size-4 accent-[var(--accent)]" />
                            <span className="min-w-0 flex-1 truncate">
                              {o.name}
                              {o.level === 'state' && <span className="ml-1 text-xs text-fg-subtle">(state-level)</span>}
                            </span>
                            <span className="text-xs tabular text-fg-muted">{o.maxTmax.toFixed(1)} °C</span>
                            <SeverityBadge severity={o.severity} size="sm" />
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="2 · Audience" description="The advisory is written for one audience at a time.">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1" role="radiogroup" aria-label="Audience">
            {audiences.map((a) => (
              <label
                key={a.key}
                className={cn('flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 transition', audience === a.key ? 'border-accent bg-accent-soft' : 'border-line hover:bg-accent-soft/60')}
              >
                <input type="radio" name="audience" value={a.key} checked={audience === a.key} onChange={() => (setAudience(a.key), setResult(null))} className="mt-1 accent-[var(--accent)]" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{a.label}</span>
                  <span className="line-clamp-2 text-xs text-fg-muted">{a.brief}</span>
                </span>
              </label>
            ))}
          </div>
        </Panel>

        <div className="glass flex flex-col gap-3 rounded-2xl p-4">
          <p className="text-xs text-fg-muted">
            <span className="font-semibold text-fg">Provider:</span> {providerLabel}
          </p>
          <Button type="button" size="lg" onClick={generate} disabled={generating || selected.length === 0}>
            {generating ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Sparkles aria-hidden className="size-4" />}
            {generating ? 'Generating preview…' : result ? 'Regenerate preview' : 'Generate preview'}
          </Button>
          {selected.length === 0 && <p className="text-xs text-fg-subtle">Select at least one region.</p>}
          {error && (
            <p role="alert" className="text-sm font-medium text-accent">
              {error}
            </p>
          )}
        </div>
      </div>

      <div aria-live="polite" className="min-w-0">
        {generating ? (
          <Panel title="Generating…">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </Panel>
        ) : !result ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-[var(--radius-glass)] border border-dashed border-line-strong px-6 py-12 text-center">
            <Sparkles aria-hidden className="size-6 text-accent" />
            <p className="font-medium">Preview appears here</p>
            <p className="max-w-md text-sm text-fg-muted">Nothing is stored until you save the draft. Drafts must be approved and published by an authorised official before anyone else relies on them.</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={result.preview.generatedAt}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-5"
            >
              <Panel>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <OriginTag origin="climatiq" />
                    <SeverityBadge severity={result.preview.severity} />
                    <AudienceBadge audience={result.preview.audience} />
                    <ScenarioBadge scenario={result.preview.bundle.run.scenario} />
                    <span className="rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] font-semibold text-fg-muted">Preview · not saved</span>
                  </div>
                  <h2 className="text-xl font-semibold leading-snug">{result.preview.title}</h2>
                  <p className="text-xs text-fg-muted">
                    Valid {fmtDate(result.preview.validFrom)} – {fmtDate(result.preview.validTo)} · expected spell up to {result.preview.expectedDurationDays} day(s) · confidence {result.preview.confidence} (heuristic)
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="button" onClick={save} disabled={saving}>
                      {saving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />} Save as draft
                    </Button>
                    <Button type="button" variant="secondary" onClick={generate} disabled={generating || saving}>
                      <RotateCcw aria-hidden className="size-4" /> Regenerate
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setResult(null)} disabled={saving}>
                      <Trash2 aria-hidden className="size-4" /> Discard
                    </Button>
                  </div>
                </div>
              </Panel>
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_20rem]">
                <Panel title="Advisory content">
                  <AdvisoryContentView content={result.preview.content} compact />
                </Panel>
                <div className="flex flex-col gap-5">
                  <Panel title="Provenance">
                    <ProvenanceList p={{ ...result.preview, generatedByName: `${userName} (preview)` }} />
                    {!result.preview.fallbackReason && result.preview.provider === 'template' && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted">
                        <Check aria-hidden className="size-3.5" /> Deterministic template — every number comes from the forecast bundle.
                      </p>
                    )}
                  </Panel>
                  <Panel title="Data sources" description="Attached by the server from the forecast bundle.">
                    <SourceRefs refs={result.preview.sourceRefs} />
                  </Panel>
                </div>
              </div>
              <BundleInspector bundle={result.preview.bundle} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
