import { TEMPLATE_KEYS, type TemplateKey } from '@ecomkit/core/contracts';
import { audit } from '@ecomkit/core/audit';
import { db, withTx, type DbOrTx } from '@ecomkit/core/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_TEMPLATES, STORE_NAME_VAR, TEMPLATE_CHANNELS, fillTemplate, templateVariables, textToHtml, whatsappTemplateName, type Category, type TemplateChannel } from '../domain/templates';
import { notificationsTemplate } from '../schema';

export interface ResolvedTemplate {
  key: TemplateKey;
  channel: TemplateChannel;
  category: Category;
  subject: string;
  body: string;
  metaTemplateName: string;
  /** 0 = the built-in default, else the admin override's version. */
  version: number;
}

const LOCALE = 'en';

/** The template for a key and channel: the admin override when one exists, else the default. */
export async function resolveTemplate(key: TemplateKey, channel: TemplateChannel, dbOrTx: DbOrTx = db): Promise<ResolvedTemplate> {
  const d = DEFAULT_TEMPLATES[key];
  const [row] = await dbOrTx
    .select()
    .from(notificationsTemplate)
    .where(and(eq(notificationsTemplate.key, key), eq(notificationsTemplate.channel, channel), eq(notificationsTemplate.locale, LOCALE)));
  return row
    ? { key, channel, category: d.category, subject: row.subject ?? d.subject, body: row.body, metaTemplateName: row.metaTemplateName ?? whatsappTemplateName(key), version: row.version }
    : { key, channel, category: d.category, subject: d.subject, body: d.body, metaTemplateName: whatsappTemplateName(key), version: 0 };
}

export interface RenderedTemplate {
  template: ResolvedTemplate;
  subject: string;
  text: string;
  html: string;
  /** Exactly the variables the template uses (what a named-param WhatsApp template expects). */
  params: Record<string, string>;
}

/** Renders a template with the caller's variables. Throws `MissingTemplateVariableError` when one is missing. */
export async function renderTemplate(key: TemplateKey, channel: TemplateChannel, vars: Readonly<Record<string, string | number>>, dbOrTx?: DbOrTx): Promise<RenderedTemplate> {
  const template = await resolveTemplate(key, channel, dbOrTx);
  const subject = fillTemplate(key, template.subject, vars);
  const text = fillTemplate(key, template.body, vars);
  const params = Object.fromEntries(templateVariables(template.body).map((v) => [v, String(vars[v])]));
  return { template, subject, text, html: textToHtml(text), params };
}

/** Every key on every channel, override or default, for the admin list. */
export async function listTemplates(): Promise<ResolvedTemplate[]> {
  const rows = await db.select().from(notificationsTemplate).where(eq(notificationsTemplate.locale, LOCALE));
  return TEMPLATE_KEYS.flatMap((key) =>
    TEMPLATE_CHANNELS.map((channel) => {
      const d = DEFAULT_TEMPLATES[key];
      const row = rows.find((r) => r.key === key && r.channel === channel);
      return {
        key,
        channel,
        category: d.category,
        subject: row?.subject ?? d.subject,
        body: row?.body ?? d.body,
        metaTemplateName: row?.metaTemplateName ?? whatsappTemplateName(key),
        version: row?.version ?? 0,
      };
    }),
  );
}

export const templateInputSchema = z.object({
  key: z.enum(TEMPLATE_KEYS),
  channel: z.enum(TEMPLATE_CHANNELS),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(4000),
});

export class TemplateVariableError extends Error {}

/**
 * Saves an admin override (version + 1, audited). The text may only use variables the default uses,
 * because callers pass exactly those: a new `{{x}}` would fail every send.
 */
export async function saveTemplate(input: z.input<typeof templateInputSchema>, actorId: string | null): Promise<ResolvedTemplate> {
  const data = templateInputSchema.parse(input);
  const d = DEFAULT_TEMPLATES[data.key];
  const allowed = new Set([...templateVariables(d.subject, d.body), STORE_NAME_VAR]);
  const unknown = templateVariables(data.subject, data.body).filter((v) => !allowed.has(v));
  if (unknown.length) throw new TemplateVariableError(`unknown variables: ${unknown.join(', ')} (allowed: ${[...allowed].join(', ')})`);
  if (/\u2014/.test(`${data.subject ?? ''}${data.body}`)) throw new TemplateVariableError('em dashes are not allowed in message copy');

  return withTx(async (tx) => {
    const before = await resolveTemplate(data.key, data.channel, tx);
    const version = before.version + 1;
    const values = {
      key: data.key,
      channel: data.channel,
      locale: LOCALE,
      subject: data.subject ?? null,
      body: data.body,
      metaTemplateName: whatsappTemplateName(data.key),
      category: d.category,
      variables: templateVariables(data.subject, data.body),
      version,
      updatedBy: actorId,
      updatedAt: new Date(),
    };
    await tx
      .insert(notificationsTemplate)
      .values(values)
      .onConflictDoUpdate({ target: [notificationsTemplate.key, notificationsTemplate.channel, notificationsTemplate.locale], set: { subject: values.subject, body: values.body, variables: values.variables, version, updatedBy: actorId, updatedAt: values.updatedAt } });
    await audit(
      { actorId, actorType: actorId ? 'staff' : 'system', action: 'notifications.template.update', entity: 'notifications_template', entityId: `${data.key}:${data.channel}`, before: { subject: before.subject, body: before.body, version: before.version }, after: { subject: values.subject, body: values.body, version } },
      { tx },
    );
    return resolveTemplate(data.key, data.channel, tx);
  });
}

/** Drops the override so the default applies again. */
export async function resetTemplate(key: TemplateKey, channel: TemplateChannel, actorId: string | null): Promise<void> {
  await withTx(async (tx) => {
    await tx.delete(notificationsTemplate).where(and(eq(notificationsTemplate.key, key), eq(notificationsTemplate.channel, channel), eq(notificationsTemplate.locale, LOCALE)));
    await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'notifications.template.reset', entity: 'notifications_template', entityId: `${key}:${channel}` }, { tx });
  });
}
