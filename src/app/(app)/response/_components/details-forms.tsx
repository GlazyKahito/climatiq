'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { PRIORITY_META, SEVERITY_META } from '@/lib/domain';
import { addNoteAction, assignIncidentAction, updateIncidentAction } from '../actions';

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-xs text-fg-muted' : 'text-xs font-medium text-accent'}>
      {msg.text}
    </p>
  );
}

/** Team / owner assignment (`incident:assign`). Assignees are notified in-app. */
export function AssignForm({
  incidentRef,
  teamId,
  ownerId,
  teams,
  owners,
}: {
  incidentRef: string;
  teamId: number | null;
  ownerId: string | null;
  teams: { id: number; name: string; regionName: string }[];
  owners: { id: string; name: string; designation: string | null }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [team, setTeam] = useState(teamId ? String(teamId) : '');
  const [owner, setOwner] = useState(ownerId ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = team !== (teamId ? String(teamId) : '') || owner !== (ownerId ?? '');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await assignIncidentAction(incidentRef, { teamId: team, ownerId: owner });
          setMsg(res.ok ? { ok: true, text: res.message ?? 'Saved' } : { ok: false, text: res.error });
          if (res.ok) router.refresh();
        });
      }}
    >
      <Field label="Team" htmlFor="assign-team">
        <Select id="assign-team" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.regionName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Owner" htmlFor="assign-owner" hint="Officials who can update incidents in this region.">
        <Select id="assign-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">No owner</option>
          {owners.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" size="sm" variant="secondary" disabled={!dirty || pending}>
        {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Save aria-hidden className="size-3.5" />} Save assignment
      </Button>
      <Msg msg={msg} />
    </form>
  );
}

/** Priority, severity and due date (`incident:update`). */
export function FieldsForm({ incidentRef, priority, severity, dueAt }: { incidentRef: string; priority: string; severity: string; dueAt: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initialDue = dueAt ? new Date(dueAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '';
  const [p, setP] = useState(priority);
  const [s, setS] = useState(severity);
  const [d, setD] = useState(initialDue);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = p !== priority || s !== severity || d !== initialDue;
  return (
    <form
      className="grid grid-cols-2 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateIncidentAction(incidentRef, { priority: p, severity: s, dueAt: d || null });
          setMsg(res.ok ? { ok: true, text: res.message ?? 'Saved' } : { ok: false, text: res.error });
          if (res.ok) router.refresh();
        });
      }}
    >
      <Field label="Priority" htmlFor="f-priority">
        <Select id="f-priority" value={p} onChange={(e) => setP(e.target.value)}>
          {Object.entries(PRIORITY_META).map(([v, m]) => (
            <option key={v} value={v}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Severity" htmlFor="f-severity">
        <Select id="f-severity" value={s} onChange={(e) => setS(e.target.value)}>
          {Object.entries(SEVERITY_META).map(([v, m]) => (
            <option key={v} value={v}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="col-span-2">
        <Field label="Due date" htmlFor="f-due">
          <Input id="f-due" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </Field>
      </div>
      <div className="col-span-2 flex flex-col gap-1.5">
        <Button type="submit" size="sm" variant="secondary" disabled={!dirty || pending}>
          {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Save aria-hidden className="size-3.5" />} Save details
        </Button>
        <Msg msg={msg} />
      </div>
    </form>
  );
}

export function NoteForm({ incidentRef }: { incidentRef: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addNoteAction(incidentRef, body);
          setMsg(res.ok ? { ok: true, text: res.message ?? 'Added' } : { ok: false, text: res.error });
          if (res.ok) {
            setBody('');
            router.refresh();
          }
        });
      }}
    >
      <label htmlFor="note-body" className="sr-only">
        Add a note
      </label>
      <Textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the team…" maxLength={2000} rows={2} className="min-h-16" />
      <div className="flex items-center justify-between gap-2">
        <Msg msg={msg} />
        <Button type="submit" size="sm" disabled={pending || body.trim().length < 2} className="ml-auto">
          {pending && <Loader2 aria-hidden className="size-3.5 animate-spin" />} Add note
        </Button>
      </div>
    </form>
  );
}
