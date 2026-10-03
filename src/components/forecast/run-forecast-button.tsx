'use client';

import { useEffect, useState, useTransition } from 'react';
import { CircleCheck, CircleAlert, Play, LoaderCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type Result = { ok: boolean; message: string; at: number };

/** Triggers a live forecast run via a server action; shows pending state and a dismissible result toast. */
export function RunForecastButton({ action, scenario }: { action: () => Promise<Result>; scenario: 'live' | 'replay' }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), result.ok ? 7000 : 12000);
    return () => clearTimeout(t);
  }, [result]);

  return (
    <>
      <Button
        type="button"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            try {
              setResult(await action());
            } catch {
              setResult({ ok: false, message: 'The request failed. Check your connection and retry.', at: Date.now() });
            }
          })
        }
        title={scenario === 'replay' ? 'Runs a new LIVE forecast for today (switch to Live to view it).' : 'Runs a new live forecast for today.'}
      >
        {pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        {pending ? 'Running forecast…' : 'Run live forecast now'}
      </Button>
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-3 bottom-4 z-50 flex justify-center sm:inset-x-auto sm:right-6">
        {result && (
          <div
            className={cn(
              'glass-strong pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl px-4 py-3 text-sm shadow-xl',
              result.ok ? 'text-fg' : 'border-accent/40 text-fg',
            )}
          >
            {result.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--sev-low)' }} aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />}
            <p className="min-w-0">
              {result.message}
              {result.ok && scenario === 'replay' && <span className="block text-xs text-fg-muted">You are viewing the historical replay — switch the scenario to Live to see the new run.</span>}
            </p>
            <button type="button" onClick={() => setResult(null)} className="ml-1 rounded p-0.5 text-fg-subtle hover:text-fg" aria-label="Dismiss">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
