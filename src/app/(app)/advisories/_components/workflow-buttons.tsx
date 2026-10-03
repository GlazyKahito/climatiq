'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Archive, BadgeCheck, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { transitionAdvisoryAction } from '../actions';

const META = {
  approve: { label: 'Approve', icon: BadgeCheck, variant: 'primary' as const, confirm: 'Approve this advisory? You confirm you reviewed the content, uncertainty and limitations.' },
  publish: { label: 'Publish', icon: Send, variant: 'primary' as const, confirm: 'Publish this advisory? Public-audience advisories become visible on the public portal (labelled CLIMATIQ-generated, not official).' },
  archive: { label: 'Archive', icon: Archive, variant: 'ghost' as const, confirm: 'Archive this advisory? It will no longer be shown as current.' },
};

/** Human-in-the-loop workflow buttons; the server decides which actions are allowed (`actions`). */
export function WorkflowButtons({ id, actions }: { id: string; actions: ('approve' | 'publish' | 'archive')[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<keyof typeof META | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!actions.length) return <p className="text-xs text-fg-muted">No workflow actions are available for your role and region.</p>;

  return (
    <div className="flex flex-col gap-2">
      {confirm ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line-strong p-3" role="group" aria-label={`Confirm ${META[confirm].label.toLowerCase()}`}>
          <p className="text-sm">{META[confirm].confirm}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await transitionAdvisoryAction(id, confirm);
                  setMsg(res.ok ? { ok: true, text: res.message ?? 'Updated' } : { ok: false, text: res.error });
                  setConfirm(null);
                  if (res.ok) router.refresh();
                })
              }
            >
              {pending && <Loader2 aria-hidden className="size-3.5 animate-spin" />} Confirm
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => {
            const M = META[a];
            const Icon = M.icon;
            return (
              <Button key={a} type="button" size="sm" variant={M.variant} onClick={() => setConfirm(a)}>
                <Icon aria-hidden className="size-3.5" /> {M.label}
              </Button>
            );
          })}
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
