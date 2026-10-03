'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BadgeCheck, CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { acknowledgeAlertAction, resolveAlertAction } from '../actions';

/** Acknowledge / resolve buttons for one alert (rendered only when the server says the user may act). */
export function AlertActions({ id, canAck, canResolve, size = 'sm' }: { id: string; canAck: boolean; canResolve: boolean; size?: 'sm' | 'md' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<'ack' | 'resolve' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');

  const run = (kind: 'ack' | 'resolve') => {
    setBusy(kind);
    start(async () => {
      const res = kind === 'ack' ? await acknowledgeAlertAction(id) : await resolveAlertAction(id, note);
      setMsg(res.ok ? { ok: true, text: res.message ?? 'Done' } : { ok: false, text: res.error });
      setBusy(null);
      setConfirming(false);
      if (res.ok) router.refresh();
    });
  };

  if (!canAck && !canResolve) return null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {canAck && (
          <Button type="button" size={size} variant="secondary" disabled={pending} onClick={() => run('ack')}>
            {busy === 'ack' ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <CheckCheck aria-hidden className="size-3.5" />} Acknowledge
          </Button>
        )}
        {canResolve && !confirming && (
          <Button type="button" size={size} variant="ghost" disabled={pending} onClick={() => setConfirming(true)}>
            <BadgeCheck aria-hidden className="size-3.5" /> Resolve
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex w-full flex-col gap-1.5 rounded-xl border border-line p-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor={`resolve-note-${id}`}>
            Resolution note (optional)
          </label>
          <input
            id={`resolve-note-${id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Note (optional)"
            className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-glass-strong px-2 text-xs outline-none focus-visible:border-accent"
          />
          <div className="flex gap-1.5">
            <Button type="button" size="sm" disabled={pending} onClick={() => run('resolve')}>
              {busy === 'resolve' && <Loader2 aria-hidden className="size-3.5 animate-spin" />} Confirm resolve
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-xs text-fg-muted' : 'text-xs font-medium text-accent'}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
