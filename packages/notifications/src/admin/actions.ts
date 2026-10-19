'use server';

import { requirePermission } from '@ecomkit/core/auth-context';
import { TEMPLATE_KEYS } from '@ecomkit/core/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { TEMPLATE_CHANNELS } from '../domain/templates';
import { resetTemplate, saveTemplate, templateInputSchema, TemplateVariableError } from '../server/templates';

const PAGE = '/admin/templates';
const field = (form: FormData, key: string) => (typeof form.get(key) === 'string' ? (form.get(key) as string) : undefined);

/** Saves a template override (settings.write). Errors come back in the URL so the page works without JS. */
export async function saveTemplateAction(form: FormData): Promise<void> {
  const viewer = await requirePermission('settings.write');
  const parsed = templateInputSchema.safeParse({ key: field(form, 'key'), channel: field(form, 'channel'), subject: field(form, 'subject') || undefined, body: field(form, 'body') });
  let error: string | null = parsed.success ? null : 'Body is required (at most 4000 characters).';
  if (parsed.success) {
    try {
      await saveTemplate(parsed.data, viewer.userId);
    } catch (err) {
      if (!(err instanceof TemplateVariableError)) throw err;
      error = err.message;
    }
  }
  revalidatePath(PAGE);
  const anchor = `${field(form, 'key') ?? ''}-${field(form, 'channel') ?? ''}`.replace(/[^a-z0-9_-]/gi, '-');
  redirect(error ? `${PAGE}?error=${encodeURIComponent(error)}&at=${anchor}#${anchor}` : `${PAGE}?saved=${anchor}#${anchor}`);
}

/** Back to the default text. */
export async function resetTemplateAction(form: FormData): Promise<void> {
  const viewer = await requirePermission('settings.write');
  const data = z.object({ key: z.enum(TEMPLATE_KEYS), channel: z.enum(TEMPLATE_CHANNELS) }).parse({ key: form.get('key'), channel: form.get('channel') });
  await resetTemplate(data.key, data.channel, viewer.userId);
  revalidatePath(PAGE);
}

/** Dev outbox: simulate an inbound WhatsApp message (STOP, START, or a reply that opens the service window). */
export async function mockInboundAction(form: FormData): Promise<void> {
  await requirePermission('settings.write');
  if (process.env.ENABLE_MOCKS !== '1') return;
  const data = z.object({ from: z.string().min(8).max(20), text: z.string().min(1).max(500) }).parse({ from: form.get('from'), text: form.get('text') });
  const { POST } = await import('../mocks/meta');
  await POST(new Request('http://mock.local/api/_mock/meta/_inbound', { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json' } }));
  revalidatePath('/admin/dev/outbox');
}
