'use server';

import { requirePermission } from '@ecomkit/core/auth-context';
import { normalisePhone } from '@ecomkit/core/ids';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isFlowKey, type FlowKey } from '../domain';
import { stopAbandonedRuns, testRun } from '../server/admin';
import { saveFlow } from '../server/flows';
import { formToSettings, text } from './form';

const pageOf = (key: FlowKey) => `/admin/marketing/automations/${key}`;
const keyFrom = (form: FormData): FlowKey => {
  const key = text(form, 'key');
  if (!isFlowKey(key)) throw new Error('unknown flow');
  return key;
};

/** Saves one flow's form. Errors come back in the URL so the page works without JS. */
export async function saveFlowAction(form: FormData): Promise<void> {
  const viewer = await requirePermission('marketing.write');
  const key = keyFrom(form);
  let error: string | null = null;
  try {
    await saveFlow(key, formToSettings(form, key), viewer.userId);
  } catch (err) {
    if (!(err instanceof z.ZodError)) throw err;
    error = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  }
  revalidatePath(pageOf(key));
  redirect(error ? `${pageOf(key)}?error=${encodeURIComponent(error)}` : `${pageOf(key)}?saved=1`);
}

/** Sends the flow's messages now to a staff phone and/or email, flagged as test. */
export async function testRunAction(form: FormData): Promise<void> {
  const viewer = await requirePermission('marketing.write');
  const key = keyFrom(form);
  const phone = text(form, 'phone') ? normalisePhone(text(form, 'phone')) : null;
  const email = z.email().safeParse(text(form, 'email')).data ?? null;
  if (!phone && !email) redirect(`${pageOf(key)}?error=${encodeURIComponent('Enter a valid phone number or email for the test.')}`);
  const { messageIds } = await testRun(key, { phone, email }, viewer.userId);
  revalidatePath(pageOf(key));
  redirect(`${pageOf(key)}?tested=${messageIds.length}`);
}

/** Bulk "Stop reminders" on /admin/abandoned-checkouts (row checkboxes). */
export async function stopRemindersAction(form: FormData): Promise<void> {
  await stopAbandonedRuns(form.getAll('ids').map(String));
  revalidatePath('/admin/abandoned-checkouts');
}
