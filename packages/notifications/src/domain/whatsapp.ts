import { z } from 'zod';
import { templateVariables, type Category } from './templates';

export interface TemplateSend {
  to: string;
  name: string;
  language: string;
  category: Category;
  params: Readonly<Record<string, string>>;
}

/** Cloud API / Marketing Messages API body for a template send. Named parameters; OTP gets the copy-code button too. */
export function templatePayload(send: TemplateSend): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];
  if (send.category === 'authentication') {
    // Authentication templates use Meta's preset text with one positional code, repeated on the copy-code button.
    const code = send.params.code ?? '';
    components.push({ type: 'body', parameters: [{ type: 'text', text: code }] });
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] });
  } else if (Object.keys(send.params).length) {
    components.push({
      type: 'body',
      parameters: Object.entries(send.params).map(([name, text]) => ({ type: 'text', parameter_name: name, text })),
    });
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: send.to,
    type: 'template',
    template: { name: send.name, language: { code: send.language }, components },
  };
}

/** Free-form text, allowed only inside the 24 h service window. */
export const textPayload = (to: string, body: string) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body } });

/** `message_templates` create body for one of our templates (named params with example values). */
export function templateCreatePayload(name: string, category: Category, language: string, body: string): Record<string, unknown> {
  if (category === 'authentication') {
    return {
      name,
      category: 'AUTHENTICATION',
      language,
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 5 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
      ],
    };
  }
  const vars = templateVariables(body);
  return {
    name,
    category: category.toUpperCase(),
    language,
    parameter_format: 'named',
    components: [
      {
        type: 'BODY',
        text: body,
        ...(vars.length ? { example: { body_text_named_params: vars.map((v) => ({ param_name: v, example: `sample ${v.replace(/_/g, ' ')}` })) } } : {}),
      },
    ],
  };
}

// ---- webhooks (zod at the boundary; unknown fields pass through) ------------------------------
const errorSchema = z.object({ code: z.number(), title: z.string().optional(), message: z.string().optional(), error_data: z.object({ details: z.string().optional() }).optional() });

const statusSchema = z.object({
  id: z.string(),
  status: z.enum(['sent', 'delivered', 'read', 'played', 'failed', 'deleted', 'warning']),
  timestamp: z.string(),
  recipient_id: z.string().optional(),
  pricing: z.record(z.string(), z.unknown()).optional(),
  errors: z.array(errorSchema).optional(),
});

const inboundSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ text: z.string() }).optional(),
});

const templateUpdateSchema = z.object({
  event: z.string(),
  message_template_name: z.string(),
  message_template_language: z.string().optional(),
  message_template_id: z.union([z.string(), z.number()]).optional(),
  reason: z.string().nullish(),
});

export const webhookBodySchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      changes: z.array(z.object({ field: z.string(), value: z.record(z.string(), z.unknown()) })),
    }),
  ),
});

export type WaStatus = z.infer<typeof statusSchema>;
export type WaInbound = z.infer<typeof inboundSchema>;
export type WaTemplateUpdate = z.infer<typeof templateUpdateSchema>;

export type WebhookItem =
  | { kind: 'status'; dedupeKey: string; data: WaStatus }
  | { kind: 'inbound'; dedupeKey: string; from: string; data: WaInbound }
  | { kind: 'template'; dedupeKey: string; data: WaTemplateUpdate };

/**
 * Splits a webhook delivery (up to 1000 updates) into items, each with its dedupe key:
 * status = wamid + status, inbound = wamid, template update = name + event + id.
 * Items that do not parse are dropped (Meta sends more fields than we use).
 */
export function webhookItems(body: unknown): WebhookItem[] {
  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success) return [];
  const items: WebhookItem[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const v = change.value;
      if (change.field === 'messages') {
        for (const raw of (v.statuses as unknown[] | undefined) ?? []) {
          const s = statusSchema.safeParse(raw);
          if (s.success) items.push({ kind: 'status', dedupeKey: `wa:${s.data.id}:${s.data.status}`, data: s.data });
        }
        for (const raw of (v.messages as unknown[] | undefined) ?? []) {
          const m = inboundSchema.safeParse(raw);
          if (m.success) items.push({ kind: 'inbound', dedupeKey: `wa:in:${m.data.id}`, from: m.data.from, data: m.data });
        }
      } else if (change.field === 'message_template_status_update' || change.field === 'template_category_update') {
        const t = templateUpdateSchema.safeParse(v);
        if (t.success) items.push({ kind: 'template', dedupeKey: `wa:tpl:${t.data.message_template_name}:${t.data.event}:${t.data.message_template_id ?? ''}:${entry.id ?? ''}`, data: t.data });
      }
    }
  }
  return items;
}

/** Meta template status (APPROVED, PENDING, ...) to ours. */
export function templateStatus(event: string): 'approved' | 'pending' | 'rejected' | 'paused' | 'disabled' | null {
  const map: Record<string, 'approved' | 'pending' | 'rejected' | 'paused' | 'disabled'> = {
    APPROVED: 'approved',
    PENDING: 'pending',
    IN_APPEAL: 'pending',
    REJECTED: 'rejected',
    PAUSED: 'paused',
    DISABLED: 'disabled',
    FLAGGED: 'paused',
  };
  return map[event.toUpperCase()] ?? null;
}
