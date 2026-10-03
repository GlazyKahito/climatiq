'use client';

import { useActionState } from 'react';
import { LogIn } from 'lucide-react';
import { login, type LoginState } from '@/app/actions/session';
import { Button, Field, Input } from '@/components/ui/primitives';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} aria-invalid={Boolean(state?.error)} />
      </Field>
      <Field label="Password" htmlFor="password" error={state?.error}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(state?.error)} />
      </Field>
      <Button type="submit" disabled={pending} className="mt-1">
        <LogIn className="size-4" aria-hidden /> {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
