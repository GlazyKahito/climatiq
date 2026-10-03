'use client';

import { useState, useTransition } from 'react';
import { Loader2, Siren } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { PRIORITY_META, SEVERITY_META } from '@/lib/domain';
import { createIncidentAction, type CrmResult } from '../../actions';

export type RegionGroup = { state: string; options: { code: string; label: string }[] };
export type IncidentPrefill = {
  alertId?: string;
  advisoryId?: string;
  regionCode?: string;
  severity?: string;
  priority?: string;
  title?: string;
  description?: string;
};

export function IncidentForm({ groups, prefill }: { groups: RegionGroup[]; prefill: IncidentPrefill }) {
  const [state, setState] = useState<CrmResult | undefined>();
  const [pending, start] = useTransition();
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        // Calling the action directly (not via the `action` prop) keeps the user's input if validation fails.
        start(async () => setState(await createIncidentAction(undefined, fd)));
      }}
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      noValidate
    >
      {prefill.alertId && <input type="hidden" name="alertId" value={prefill.alertId} />}
      {prefill.advisoryId && <input type="hidden" name="advisoryId" value={prefill.advisoryId} />}
      <div className="md:col-span-2">
        <Field label="Title" htmlFor="title" error={err('title')}>
          <Input id="title" name="title" required minLength={5} maxLength={200} defaultValue={prefill.title} placeholder="e.g. Water shortage at worksites in Jaipur" />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label="Description" htmlFor="description" hint="What is happening, where, who is affected and what support is needed." error={err('description')}>
          <Textarea id="description" name="description" required minLength={10} maxLength={5000} rows={6} defaultValue={prefill.description} />
        </Field>
      </div>
      <Field label="Region" htmlFor="regionCode" error={err('regionCode')}>
        <Select id="regionCode" name="regionCode" required defaultValue={prefill.regionCode ?? ''}>
          <option value="" disabled>
            Choose a region…
          </option>
          {groups.map((g) => (
            <optgroup key={g.state} label={g.state}>
              {g.options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <Field label="Due date (optional)" htmlFor="dueAt" error={err('dueAt')}>
        <Input id="dueAt" name="dueAt" type="date" min={today} />
      </Field>
      <Field label="Severity" htmlFor="severity" error={err('severity')}>
        <Select id="severity" name="severity" defaultValue={prefill.severity ?? 'high'}>
          {Object.entries(SEVERITY_META).map(([v, m]) => (
            <option key={v} value={v}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Priority" htmlFor="priority" error={err('priority')}>
        <Select id="priority" name="priority" defaultValue={prefill.priority ?? 'p2'}>
          {Object.entries(PRIORITY_META).map(([v, m]) => (
            <option key={v} value={v}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center md:justify-between">
        <p className="text-xs text-fg-muted">The incident starts as “Reported”. Everything you do is recorded in the activity timeline and audit log.</p>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Siren aria-hidden className="size-4" />} Create incident
        </Button>
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm font-medium text-accent md:col-span-2">
          {state.error}
        </p>
      )}
    </form>
  );
}
