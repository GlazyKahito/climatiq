/** Zod request schemas shared by the REST API and server actions (advisories, alerts, notifications, incidents). */
import { z } from 'zod';

export const severityEnum = z.enum(['low', 'moderate', 'high', 'extreme']);
export const priorityEnum = z.enum(['p1', 'p2', 'p3', 'p4']);
export const incidentStatusEnum = z.enum(['reported', 'triaged', 'in_progress', 'monitoring', 'resolved', 'closed']);
export const taskStatusEnum = z.enum(['todo', 'in_progress', 'blocked', 'done']);
export const audienceEnum = z.enum(['government', 'disaster_mgmt', 'field_team', 'public']);
const regionCode = z.string().trim().min(2).max(80).regex(/^[A-Z0-9-]+$/, 'Invalid region code');

/** Accepts ISO date (YYYY-MM-DD → end of that day IST) or full datetime; '' / null clears. */
export const dueDate = z
  .union([z.string().trim(), z.null()])
  .transform((v, ctx) => {
    if (v == null || v === '') return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T18:00:00+05:30`) : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Invalid date' });
      return z.NEVER;
    }
    return d;
  });

export const pagination = {
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
};

// ── Advisories ──
export const advisoryGenerateInput = z.object({
  runId: z.string().uuid().optional(),
  scenario: z.enum(['live', 'replay']).optional(),
  regionCodes: z.array(regionCode).min(1).max(12),
  audience: audienceEnum,
  dryRun: z.boolean().optional(),
});
export const advisoryListQuery = z.object({
  status: z.enum(['draft', 'approved', 'published', 'archived', 'all']).optional(),
  audience: audienceEnum.optional(),
  severity: severityEnum.optional(),
  region: regionCode.optional(),
  scenario: z.enum(['live', 'replay']).optional(),
  ...pagination,
});
export const advisoryAction = z.enum(['approve', 'publish', 'archive']);

// ── Alerts ──
export const alertListQuery = z.object({
  status: z.enum(['open', 'active', 'acknowledged', 'resolved', 'expired', 'all']).optional(),
  severity: severityEnum.optional(),
  region: regionCode.optional(),
  scenario: z.enum(['live', 'replay', 'all']).optional(),
  ...pagination,
});
export const alertEvaluateInput = z.object({ runId: z.string().uuid() });
export const alertResolveInput = z.object({ note: z.string().trim().max(500).optional() });

// ── Notifications ──
export const notificationListQuery = z.object({
  status: z.enum(['all', 'unread', 'read']).optional(),
  severity: severityEnum.optional(),
  kind: z.enum(['alert', 'advisory', 'incident', 'system']).optional(),
  region: regionCode.optional(),
  ...pagination,
});
export const notificationReadInput = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(200), unread: z.boolean().optional() }),
]);

// ── Incidents ──
export const incidentCreateInput = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(200),
  description: z.string().trim().min(10, 'Describe the situation (at least 10 characters)').max(5000),
  regionCode,
  severity: severityEnum,
  priority: priorityEnum,
  alertId: z.string().uuid().nullish(),
  advisoryId: z.string().uuid().nullish(),
  teamId: z.coerce.number().int().positive().nullish(),
  ownerId: z.string().uuid().nullish(),
  dueAt: dueDate.optional(),
});
export const incidentListQuery = z.object({
  status: z.union([incidentStatusEnum, z.enum(['active', 'all'])]).optional(),
  priority: priorityEnum.optional(),
  severity: severityEnum.optional(),
  region: regionCode.optional(),
  teamId: z.coerce.number().int().positive().optional(),
  mine: z.enum(['true', 'false']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(80).optional(),
  ...pagination,
});
export const incidentPatchInput = z.object({
  title: z.string().trim().min(5).max(200).optional(),
  description: z.string().trim().min(10).max(5000).optional(),
  priority: priorityEnum.optional(),
  severity: severityEnum.optional(),
  dueAt: dueDate.optional(),
  teamId: z.coerce.number().int().positive().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
});
export const incidentTransitionInput = z.object({
  to: incidentStatusEnum,
  resolutionSummary: z.string().trim().max(4000).optional(),
  note: z.string().trim().max(2000).optional(),
});
export const noteInput = z.object({ body: z.string().trim().min(2, 'Write a note first').max(2000) });
export const taskCreateInput = z.object({
  title: z.string().trim().min(3, 'Task title is too short').max(300),
  priority: priorityEnum.optional(),
  assigneeId: z.string().uuid().nullish(),
  dueAt: dueDate.optional(),
});
export const taskPatchInput = z.object({
  title: z.string().trim().min(3).max(300).optional(),
  status: taskStatusEnum.optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueAt: dueDate.optional(),
});
export const incidentRef = z.string().regex(/^INC-\d{4}-\d{4,6}$/, 'Invalid incident reference');
