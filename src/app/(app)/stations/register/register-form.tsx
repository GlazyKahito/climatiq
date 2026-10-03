'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { registerStationAction, type RegisterState } from '../actions';
import { CopyButton } from '../station-ui';

type Group = { state: { code: string; name: string } | null; options: { code: string; name: string; level: string }[] };

const SENSORS = [
  ['temperature', 'Air temperature'],
  ['humidity', 'Relative humidity'],
  ['wind', 'Wind speed'],
  ['pressure', 'Pressure'],
] as const;

export function RegisterForm({ groups, appUrl }: { groups: Group[]; appUrl: string }) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerStationAction, undefined);
  const [exampleObservedAt] = useState(() => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 19));

  if (state?.result) {
    const { code, apiKey, name } = state.result;
    const curl = `curl -X POST ${appUrl}/api/v1/stations/${code}/observations \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"observedAt":"${exampleObservedAt}+05:30","tempC":38.5,"humidityPct":31}'`;
    return (
      <div role="status" className="flex flex-col gap-4">
        <div className="rounded-2xl border border-accent/40 bg-accent-soft p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <KeyRound className="size-4 text-accent" aria-hidden /> {name} registered as <span className="font-mono">{code}</span>
          </p>
          <p className="mt-2 flex gap-2 text-xs text-fg-muted">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>
              This API key is shown <strong className="text-fg">only once</strong>. Store it in the device&apos;s secure configuration now — CLIMATIQ keeps only a
              SHA-256 hash and cannot display it again. A lost key can be rotated from the station page.
            </span>
          </p>
          <code className="mt-3 block break-all rounded-lg bg-glass-strong px-3 py-2 font-mono text-sm text-fg">{apiKey}</code>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={apiKey} label="Copy key" />
            <CopyButton text={curl} label="Copy curl example" />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-fg-muted">Test request</p>
          <pre className="overflow-x-auto rounded-xl bg-accent-soft p-3 font-mono text-[11px] text-fg">{curl}</pre>
          <p className="mt-1 text-xs text-fg-muted">
            The station stays “planned” until its first accepted observation. Data is stored as unverified; implausible values and sudden jumps are flagged suspect.
          </p>
        </div>
        <Link href={`/stations/${code}`} className="w-fit text-sm font-semibold text-accent hover:underline">
          Open station page →
        </Link>
      </div>
    );
  }

  const v = state?.values;
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state?.error && (
        <p role="alert" className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
          {state.error}
        </p>
      )}
      <Field label="Station name" htmlFor="st-name" error={fe.name} hint="e.g. “Jaipur collectorate rooftop sensor”">
        <Input id="st-name" name="name" required minLength={3} maxLength={80} defaultValue={v?.name} aria-invalid={Boolean(fe.name)} />
      </Field>
      <Field label="State or district" htmlFor="st-region" error={fe.regionCode} hint="Only regions where you may manage stations are listed.">
        <Select id="st-region" name="regionCode" required defaultValue={v?.regionCode ?? ''} aria-invalid={Boolean(fe.regionCode)}>
          <option value="" disabled>
            Choose…
          </option>
          {groups.map((g) => (
            <optgroup key={g.state?.code ?? g.options[0]?.code} label={g.state?.name ?? 'Region'}>
              {g.options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Latitude (° N)" htmlFor="st-lat" error={fe.lat}>
          <Input id="st-lat" name="lat" inputMode="decimal" required placeholder="26.9124" defaultValue={v?.lat} aria-invalid={Boolean(fe.lat)} />
        </Field>
        <Field label="Longitude (° E)" htmlFor="st-lon" error={fe.lon}>
          <Input id="st-lon" name="lon" inputMode="decimal" required placeholder="75.7873" defaultValue={v?.lon} aria-invalid={Boolean(fe.lon)} />
        </Field>
        <Field label="Elevation (m, optional)" htmlFor="st-elev" error={fe.elevationM}>
          <Input id="st-elev" name="elevationM" inputMode="numeric" placeholder="431" defaultValue={v?.elevationM} aria-invalid={Boolean(fe.elevationM)} />
        </Field>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-xs font-semibold text-fg-muted">Sensors</legend>
        <div className="flex flex-wrap gap-2">
          {SENSORS.map(([key, label]) => (
            <label key={key} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line-strong px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="sensors" value={key} defaultChecked={v?.sensors ? v.sensors.includes(key) : key === 'temperature' || key === 'humidity'} className="accent-[var(--accent)]" />
              {label}
            </label>
          ))}
        </div>
        {fe.sensors && (
          <p role="alert" className="text-xs font-medium text-accent">
            {fe.sensors}
          </p>
        )}
      </fieldset>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Registering…' : 'Register station & create API key'}
      </Button>
    </form>
  );
}
