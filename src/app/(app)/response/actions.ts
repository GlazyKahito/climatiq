'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { requireUser } from '@/server/auth/dal';
import { rateLimit } from '@/server/http';
import { userMessage } from '@/server/alerts/errors';
import {
  incidentCreateInput,
  incidentPatchInput,
  incidentRef,
  incidentTransitionInput,
  noteInput,
  taskCreateInput,
  taskPatchInput,
} from '@/server/incidents/inputs';
import { addNote, assignIncident, createIncident, createTask, deleteTask, transitionIncident, updateIncident, updateTask } from '@/server/incidents/service';

export type CrmResult = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function touch(ref?: string) {
  revalidatePath('/response');
  revalidatePath('/response/incidents');
  if (ref) revalidatePath(`/response/incidents/${ref}`);
  revalidatePath('/', 'layout'); // notification badge
}

function fieldErrors(e: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of e.issues) out[String(i.path[0] ?? 'form')] ??= i.message;
  return out;
}

/** Form action for /response/incidents/new (useActionState). Redirects to the new incident on success. */
export async function createIncidentAction(_prev: CrmResult | undefined, form: FormData): Promise<CrmResult> {
  const user = await requireUser();
  let ref: string;
  try {
    rateLimit(`incident-create:${user.id}`, 20, 60_000);
    const raw = Object.fromEntries([...form.entries()].filter(([, v]) => v !== ''));
    const parsed = incidentCreateInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Please fix the highlighted fields.', fieldErrors: fieldErrors(parsed.error) };
    ({ ref } = await createIncident(getDb(), user, { ...parsed.data, dueAt: parsed.data.dueAt ?? null }));
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  touch();
  redirect(`/response/incidents/${ref}`);
}

export async function transitionIncidentAction(ref: string, input: { to: string; resolutionSummary?: string; note?: string }): Promise<CrmResult> {
  const user = await requireUser();
  try {
    const r = incidentRef.parse(ref);
    const body = incidentTransitionInput.parse(input);
    const res = await transitionIncident(getDb(), user, r, body.to, body);
    touch(r);
    return { ok: true, message: `Status changed to ${res.to.replace('_', ' ')}.` };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function assignIncidentAction(ref: string, input: { teamId: string; ownerId: string }): Promise<CrmResult> {
  const user = await requireUser();
  try {
    const r = incidentRef.parse(ref);
    const body = incidentPatchInput.pick({ teamId: true, ownerId: true }).parse({ teamId: input.teamId === '' ? null : input.teamId, ownerId: input.ownerId === '' ? null : input.ownerId });
    await assignIncident(getDb(), user, r, body);
    touch(r);
    return { ok: true, message: 'Assignment saved.' };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function updateIncidentAction(ref: string, input: { priority?: string; severity?: string; dueAt?: string | null }): Promise<CrmResult> {
  const user = await requireUser();
  try {
    const r = incidentRef.parse(ref);
    const body = incidentPatchInput.pick({ priority: true, severity: true, dueAt: true }).parse(input);
    const res = await updateIncident(getDb(), user, r, body);
    touch(r);
    return { ok: true, message: res.changed.length ? 'Saved.' : 'No changes.' };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function addNoteAction(ref: string, body: string): Promise<CrmResult> {
  const user = await requireUser();
  try {
    const r = incidentRef.parse(ref);
    rateLimit(`incident-note:${user.id}`, 30, 60_000);
    await addNote(getDb(), user, r, noteInput.parse({ body }).body);
    touch(r);
    return { ok: true, message: 'Note added.' };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function createTaskAction(ref: string, input: { title: string; priority?: string; assigneeId?: string; dueAt?: string }): Promise<CrmResult> {
  const user = await requireUser();
  try {
    const r = incidentRef.parse(ref);
    const body = taskCreateInput.parse({ ...input, assigneeId: input.assigneeId || null, dueAt: input.dueAt || null, priority: input.priority || undefined });
    await createTask(getDb(), user, r, { ...body, dueAt: body.dueAt ?? null });
    touch(r);
    return { ok: true, message: 'Task added.' };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function updateTaskAction(
  ref: string,
  taskId: string,
  input: { title?: string; status?: string; priority?: string; assigneeId?: string | null; dueAt?: string | null },
): Promise<CrmResult> {
  const user = await requireUser();
  try {
    const r = incidentRef.parse(ref);
    const body = taskPatchInput.parse(input);
    await updateTask(getDb(), user, r, z.string().uuid().parse(taskId), body);
    touch(r);
    return { ok: true, message: 'Task updated.' };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function deleteTaskAction(ref: string, taskId: string): Promise<CrmResult> {
  const user = await requireUser();
  try {
    const r = incidentRef.parse(ref);
    await deleteTask(getDb(), user, r, z.string().uuid().parse(taskId));
    touch(r);
    return { ok: true, message: 'Task removed.' };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}
