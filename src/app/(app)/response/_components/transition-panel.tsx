'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Field, Textarea } from '@/components/ui/primitives';
import type { IncidentStatus } from '@/lib/domain';
import { transitionIncidentAction } from '../actions';

type T = { to: IncidentStatus; label: string; needsSummary: boolean };

/** Status workflow buttons. Only transitions the server allows for this user are passed in. */
export function TransitionPanel({ incidentRef, transitions, existingSummary }: { incidentRef: string; transitions: T[]; existingSummary: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<T | null>(null);
  const [summary, setSummary] = useState(existingSummary ?? '');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!transitions.length) return <p className="text-xs text-fg-muted">No status changes are available for your role.</p>;

  const submit = () => {
    if (!chosen) return;
    start(async () => {
      const res = await transitionIncidentAction(incidentRef, { to: chosen.to, resolutionSummary: chosen.needsSummary ? summary : undefined, note: note || undefined });
      setMsg(res.ok ? { ok: true, text: res.message ?? 'Updated' } : { ok: false, text: res.error });
      if (res.ok) {
        setChosen(null);
        setNote('');
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => (
          <Button
            key={t.to}
            type="button"
            size="sm"
            variant={chosen?.to === t.to ? 'primary' : t.label === 'Reopen' ? 'ghost' : 'secondary'}
            onClick={() => (setChosen(chosen?.to === t.to ? null : t), setMsg(null))}
            aria-pressed={chosen?.to === t.to}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {chosen && (
        <div className="flex flex-col gap-3 rounded-xl border border-line-strong p-3">
          {chosen.needsSummary && (
            <Field label="Resolution summary (required)" htmlFor="resolution" hint="What was done and the outcome. At least 10 characters.">
              <Textarea id="resolution" value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} maxLength={4000} />
            </Field>
          )}
          <Field label="Note (optional)" htmlFor="transition-note">
            <Textarea id="transition-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="min-h-16" />
          </Field>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={submit} disabled={pending || (chosen.needsSummary && summary.trim().length < 10)}>
              {pending && <Loader2 aria-hidden className="size-3.5 animate-spin" />} Confirm: {chosen.label}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(null)} disabled={pending}>
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
