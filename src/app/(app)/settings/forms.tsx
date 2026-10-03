'use client';

import { useActionState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui/primitives';
import { changePassword, updateProfile, type FormState } from './actions';
import { restartTour } from '@/components/tour/guided-tour';

function Status({ state }: { state: FormState }) {
  if (state?.ok)
    return (
      <p role="status" className="flex items-center gap-1.5 text-sm text-sev-low">
        <CheckCircle2 className="size-4" aria-hidden /> {state.ok}
      </p>
    );
  if (state?.error)
    return (
      <p role="alert" className="text-sm font-medium text-accent">
        {state.error}
      </p>
    );
  return null;
}

export function ProfileForm({ name, designation }: { name: string; designation: string | null }) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Display name" htmlFor="name">
        <Input id="name" name="name" defaultValue={name} required minLength={2} maxLength={80} />
      </Field>
      <Field label="Designation" htmlFor="designation" hint="Shown to colleagues in incidents and advisories.">
        <Input id="designation" name="designation" defaultValue={designation ?? ''} maxLength={120} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save profile'}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function PasswordForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset disabled={disabled} className="flex flex-col gap-3 disabled:opacity-60">
        <Field label="Current password" htmlFor="current">
          <Input id="current" name="current" type="password" autoComplete="current-password" required />
        </Field>
        <Field label="New password" htmlFor="next" hint="At least 10 characters.">
          <Input id="next" name="next" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || disabled} variant="secondary">
          {pending ? 'Changing…' : 'Change password'}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function RestartTourButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => restartTour()}>
      <RotateCcw className="size-4" aria-hidden /> Restart guided tour
    </Button>
  );
}
