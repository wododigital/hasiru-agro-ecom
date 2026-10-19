'use server';

import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import type { Permission } from '@ecomkit/core/contracts';
import { formDataToObject } from '@ecomkit/core/validation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ruleUpdateSchema } from '../domain';
import { ackIssue, resolveAlertById, updateRule } from '../server/alerts';
import { scanHealth } from '../server/scans';
import { issueStatusSchema, retryJob, retryJobSchema, setErrorIssueStatus } from '../server/views';

/**
 * Plain form actions (work without JS): permission, zod, mutate, refresh the Health screens.
 * A missing permission or a bad form is a no-op; the screens only show buttons the viewer may use.
 */
async function run<S extends z.ZodType>(permission: Permission, schema: S, form: FormData, fn: (input: z.infer<S>, actorId: string) => Promise<unknown>): Promise<void> {
  let actorId: string;
  try {
    actorId = (await requirePermission(permission)).userId;
  } catch (err) {
    if (err instanceof ForbiddenError) return;
    throw err;
  }
  const parsed = schema.safeParse(formDataToObject(form));
  if (!parsed.success) return;
  await fn(parsed.data, actorId);
  revalidatePath('/admin/health', 'layout');
}

const idForm = z.object({ id: z.uuid() });

export async function ackAlertAction(form: FormData): Promise<void> {
  await run('health.read', idForm, form, (v, actor) => ackIssue(v.id, actor));
}

export async function resolveAlertAction(form: FormData): Promise<void> {
  await run('health.read', idForm, form, (v, actor) => resolveAlertById(v.id, actor));
}

/** The rule form: unchecked boxes are absent, an empty repeat means none. */
const ruleForm = ruleUpdateSchema.extend({
  channels: z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), ruleUpdateSchema.shape.channels),
  repeatMinutes: z.preprocess((v) => (v === '' || v == null ? null : v), ruleUpdateSchema.shape.repeatMinutes),
  isActive: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});

export async function updateRuleAction(form: FormData): Promise<void> {
  await run('settings.write', ruleForm, form, (v, actor) => updateRule(v, actor));
}

export async function retryJobAction(form: FormData): Promise<void> {
  await run('jobs.retry', retryJobSchema, form, (v, actor) => retryJob(v, actor));
}

export async function issueStatusAction(form: FormData): Promise<void> {
  await run('health.read', issueStatusSchema, form, (v, actor) => setErrorIssueStatus(v, actor));
}

export async function runChecksAction(form: FormData): Promise<void> {
  await run('health.read', z.object({}), form, () => scanHealth(new Date()));
}
