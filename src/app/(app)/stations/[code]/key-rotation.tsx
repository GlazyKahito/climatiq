'use client';

import { useActionState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { rotateKeyAction, type RotateState } from '../actions';
import { CopyButton } from '../station-ui';

/** Rotate an IoT station's API key; the new key is shown exactly once. */
export function KeyRotation({ code }: { code: string }) {
  const [state, action, pending] = useActionState<RotateState, FormData>(rotateKeyAction, undefined);
  return (
    <div className="flex flex-col gap-2">
      {state?.apiKey ? (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent-soft p-3">
          <p className="text-xs font-semibold text-fg">New API key — shown only once. The previous key no longer works.</p>
          <code className="block break-all rounded-lg bg-glass-strong px-2 py-1.5 font-mono text-xs text-fg">{state.apiKey}</code>
          <CopyButton text={state.apiKey} label="Copy key" />
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="code" value={code} />
          <p className="text-xs text-fg-muted">Lost or leaked key? Issue a new one. Only the SHA-256 hash is stored, so existing keys cannot be displayed.</p>
          <Button type="submit" variant="secondary" size="sm" disabled={pending} className="w-fit">
            <KeyRound className="size-3.5" aria-hidden /> {pending ? 'Rotating…' : 'Rotate API key'}
          </Button>
          {state?.error && (
            <p role="alert" className="text-xs font-medium text-accent">
              {state.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
