'use client';

import { useActionState } from 'react';
import { CheckCircle2, Loader2, Play, TriangleAlert } from 'lucide-react';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { createUserAction, grantRoleAction, resetDemoAction, runJobAction, updateConfigAction, updateThresholdAction, type ActionState } from './actions';

function Status({ state }: { state: ActionState }) {
  if (state?.ok)
    return (
      <p role="status" className="flex items-start gap-1.5 text-sm text-sev-low">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {state.ok}
      </p>
    );
  if (state?.error)
    return (
      <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-accent">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {state.error}
      </p>
    );
  return null;
}

export function JobButton({ job, label, description }: { job: 'history' | 'grid' | 'forecast' | 'retention'; label: string; description: string }) {
  const [state, action, pending] = useActionState(runJobAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-2 rounded-xl border border-line bg-glass-strong p-3">
      <input type="hidden" name="job" value={job} />
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-fg-muted">{description}</p>
      <Button type="submit" size="sm" variant="secondary" disabled={pending} className="self-start">
        {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />} {pending ? 'Running…' : 'Run now'}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function GrantRoleForm({ userId, roles }: { userId: string; roles: { key: string; name: string }[] }) {
  const [state, action, pending] = useActionState(grantRoleAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Field label="Role" htmlFor={`role-${userId}`}>
        <Select id={`role-${userId}`} name="roleKey" className="h-9 py-1">
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Region code (blank = all India)" htmlFor={`region-${userId}`}>
        <Input id={`region-${userId}`} name="regionCode" placeholder="e.g. IN-RJ" className="h-9 w-40 py-1" />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Grant
      </Button>
      <Status state={state} />
    </form>
  );
}

export function CreateUserForm({ roles }: { roles: { key: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createUserAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor="nu-name">
        <Input id="nu-name" name="name" required />
      </Field>
      <Field label="Email" htmlFor="nu-email">
        <Input id="nu-email" name="email" type="email" required />
      </Field>
      <Field label="Designation" htmlFor="nu-designation">
        <Input id="nu-designation" name="designation" />
      </Field>
      <Field label="Temporary password" htmlFor="nu-password" hint="At least 10 characters.">
        <Input id="nu-password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Role" htmlFor="nu-role">
        <Select id="nu-role" name="roleKey">
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Region code (blank = all India)" htmlFor="nu-region">
        <Input id="nu-region" name="regionCode" placeholder="e.g. IN-RJ-JAIPUR" />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create user'}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function AlertConfigForm({ values, disabled }: { values: Record<string, unknown>; disabled: boolean }) {
  const [state, action, pending] = useActionState(updateConfigAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <fieldset disabled={disabled} className="contents">
        <Field label="Minimum severity" htmlFor="c-sev">
          <Select id="c-sev" name="alerts.min_severity" defaultValue={String(values['alerts.min_severity'] ?? 'high')}>
            <option value="moderate">Moderate</option>
            <option value="high">High</option>
            <option value="extreme">Extreme</option>
          </Select>
        </Field>
        <Field label="Minimum confidence (0–1)" htmlFor="c-conf">
          <Input id="c-conf" name="alerts.min_confidence" type="number" step="0.05" min="0" max="1" defaultValue={String(values['alerts.min_confidence'] ?? 0.45)} />
        </Field>
        <Field label="Maximum lead time (days)" htmlFor="c-h">
          <Input id="c-h" name="alerts.max_horizon_days" type="number" min="1" max="7" defaultValue={String(values['alerts.max_horizon_days'] ?? 5)} />
        </Field>
        <Field label="Cooldown after resolution (hours)" htmlFor="c-cd">
          <Input id="c-cd" name="alerts.cooldown_hours" type="number" min="0" max="168" defaultValue={String(values['alerts.cooldown_hours'] ?? 24)} />
        </Field>
      </fieldset>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending || disabled}>
          Save alert rules
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ThresholdRow({ t, disabled }: { t: { id: number; zone: string; level: string; minTmaxC: number | null; minDepartureC: number | null; absoluteTmaxC: number | null }; disabled: boolean }) {
  const [state, action, pending] = useActionState(updateThresholdAction, undefined);
  if (t.level === 'low') return null;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-b border-line/60 py-2">
      <input type="hidden" name="id" value={t.id} />
      <span className="w-40 text-sm capitalize">
        {t.zone} · <strong>{t.level}</strong>
      </span>
      <Field label="Base Tmax °C" htmlFor={`t-${t.id}-a`}>
        <Input id={`t-${t.id}-a`} name="minTmaxC" type="number" step="0.5" defaultValue={t.minTmaxC ?? ''} className="h-9 w-24 py-1" disabled={disabled} />
      </Field>
      <Field label="Departure °C" htmlFor={`t-${t.id}-b`}>
        <Input id={`t-${t.id}-b`} name="minDepartureC" type="number" step="0.1" defaultValue={t.minDepartureC ?? ''} className="h-9 w-24 py-1" disabled={disabled} />
      </Field>
      <Field label="Absolute °C" htmlFor={`t-${t.id}-c`}>
        <Input id={`t-${t.id}-c`} name="absoluteTmaxC" type="number" step="0.5" defaultValue={t.absoluteTmaxC ?? ''} className="h-9 w-24 py-1" disabled={disabled} />
      </Field>
      <Button type="submit" size="sm" variant="secondary" disabled={pending || disabled}>
        Save
      </Button>
      <Status state={state} />
    </form>
  );
}

export function ResetDemoForm() {
  const [state, action, pending] = useActionState(resetDemoAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label='Type "RESET DEMO" to confirm' htmlFor="reset-confirm">
        <Input id="reset-confirm" name="confirm" autoComplete="off" placeholder="RESET DEMO" className="max-w-xs" />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} {pending ? 'Resetting…' : 'Reset demo data'}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}
