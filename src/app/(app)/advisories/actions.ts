'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { requireUser } from '@/server/auth/dal';
import { rateLimit } from '@/server/http';
import { userMessage } from '@/server/alerts/errors';
import { acknowledgeAlert, resolveAlert } from '@/server/alerts/service';
import { previewAdvisory, saveDraft, transitionAdvisory, type AdvisoryPreview } from '@/server/advisories/service';
import { signPreview, verifyPreview } from '@/server/advisories/preview-token';
import { latestRun } from '@/server/forecasting/queries';
import { currentScenario } from '@/server/scenario';
import { advisoryAction, audienceEnum } from '@/server/incidents/inputs';

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

const previewInput = z.object({
  regionCodes: z.array(z.string().regex(/^[A-Z0-9-]+$/)).min(1, 'Select at least one region').max(12, 'Select at most 12 regions'),
  audience: audienceEnum,
});

/** Generates an advisory preview (not stored). Returns the preview plus a signed token used to save it unchanged. */
export async function previewAdvisoryAction(input: { regionCodes: string[]; audience: string }): Promise<ActionResult<{ preview: AdvisoryPreview; token: string }>> {
  const user = await requireUser();
  try {
    rateLimit(`advisory-preview:${user.id}`, 10, 60_000);
    const parsed = previewInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const db = getDb();
    const run = await latestRun(db, await currentScenario());
    if (!run) return { ok: false, error: 'No completed forecast run is available for the current scenario.' };
    const preview = await previewAdvisory(db, user, { runId: run.id, regionCodes: parsed.data.regionCodes, audience: parsed.data.audience });
    return { ok: true, data: { preview, token: signPreview(user.id, preview) } };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

/** Stores a previewed advisory as a draft, exactly as generated (signature-checked), then opens it. */
export async function saveAdvisoryDraftAction(token: string): Promise<ActionResult> {
  const user = await requireUser();
  let id: string;
  try {
    const preview = verifyPreview<AdvisoryPreview>(z.string().min(10).max(2_000_000).parse(token), user.id);
    ({ id } = await saveDraft(getDb(), user, preview));
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  revalidatePath('/advisories');
  revalidatePath('/', 'layout');
  redirect(`/advisories/${id}`);
}

export async function transitionAdvisoryAction(id: string, action: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const res = await transitionAdvisory(getDb(), user, z.string().uuid().parse(id), advisoryAction.parse(action));
    revalidatePath('/advisories');
    revalidatePath(`/advisories/${id}`);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Advisory ${res.status}.` };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function acknowledgeAlertAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await acknowledgeAlert(getDb(), user, z.string().uuid().parse(id));
    revalidatePath('/advisories');
    revalidatePath(`/alerts/${id}`);
    return { ok: true, message: 'Alert acknowledged.' };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function resolveAlertAction(id: string, note?: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await resolveAlert(getDb(), user, z.string().uuid().parse(id), z.string().max(500).optional().parse(note || undefined));
    revalidatePath('/advisories');
    revalidatePath(`/alerts/${id}`);
    return { ok: true, message: 'Alert resolved.' };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}
