import { TEMPLATE_KEYS, type TemplateKey } from '@ecomkit/core/contracts';

export type Category = 'utility' | 'marketing' | 'authentication';
/** Channels that carry a template. `log` reuses the email text. */
export type TemplateChannel = 'email' | 'whatsapp' | 'sms';
export const TEMPLATE_CHANNELS = ['email', 'whatsapp', 'sms'] as const satisfies readonly TemplateChannel[];

export interface TemplateDefault {
  key: TemplateKey;
  category: Category;
  /** Email subject. */
  subject: string;
  /** Text for every channel. WhatsApp templates are registered with exactly this text (named params). */
  body: string;
}

/** Filled in by the sender from settings on every message; callers never pass it. */
export const STORE_NAME_VAR = 'store_name';
const STOP = '\nReply STOP to stop these messages.';

/**
 * Default copy for every frozen template key. Brand-neutral: the store name is the `{{store_name}}` variable.
 * Changing a string here changes what customers receive and what is submitted to WhatsApp: the exact-text
 * tests pin every line.
 */
export const DEFAULT_TEMPLATES: Readonly<Record<TemplateKey, TemplateDefault>> = {
  'otp.login': {
    key: 'otp.login',
    category: 'authentication',
    subject: 'Your {{store_name}} sign-in code',
    body: 'Your {{store_name}} sign-in code is {{code}}. It expires in 5 minutes. Do not share it with anyone.',
  },
  'otp.unlock': {
    key: 'otp.unlock',
    category: 'authentication',
    subject: 'Your {{store_name}} verification code',
    body: 'Your {{store_name}} verification code is {{code}}. It expires in 5 minutes. Do not share it with anyone.',
  },
  'order.confirmed': {
    key: 'order.confirmed',
    category: 'utility',
    subject: 'Order {{order_number}} confirmed',
    body: 'Hi {{name}}, thank you for your order {{order_number}} with {{store_name}}. Order total: {{total}}. We will message you when it is packed. View your order: {{order_link}}',
  },
  'order.packed': {
    key: 'order.packed',
    category: 'utility',
    subject: 'Order {{order_number}} is packed',
    body: 'Hi {{name}}, your order {{order_number}} is packed and will be on its way soon. Thank you for shopping with {{store_name}}.',
  },
  'order.dispatched': {
    key: 'order.dispatched',
    category: 'utility',
    subject: 'Order {{order_number}} is on its way',
    body: 'Hi {{name}}, your order {{order_number}} has been dispatched. Expected delivery: {{delivery_date}}. Thank you for shopping with {{store_name}}.',
  },
  'order.delivered': {
    key: 'order.delivered',
    category: 'utility',
    subject: 'Order {{order_number}} delivered',
    body: 'Hi {{name}}, your order {{order_number}} has been delivered. If anything is not right, reply to this message and the {{store_name}} team will help.',
  },
  'order.payment_failed': {
    key: 'order.payment_failed',
    category: 'utility',
    subject: 'Payment not confirmed for order {{order_number}}',
    body: 'Hi {{name}}, we could not confirm the payment for order {{order_number}}. You can try again here: {{pay_link}} If money was deducted, reply to this message and the {{store_name}} team will sort it out.',
  },
  'order.replacement_created': {
    key: 'order.replacement_created',
    category: 'utility',
    subject: 'Replacement order {{replacement_number}} created',
    body: 'Hi {{name}}, we have created replacement order {{replacement_number}} for your order {{order_number}}. {{store_name}} will message you when it is dispatched.',
  },
  'slot.reminder': {
    key: 'slot.reminder',
    category: 'utility',
    subject: 'Delivery reminder for order {{order_number}}',
    body: 'Hi {{name}}, a reminder from {{store_name}}: your order {{order_number}} is scheduled for delivery on {{slot_date}}, {{slot_window}}. Please make sure someone is available to receive it.',
  },
  'cart.reminder_1': {
    key: 'cart.reminder_1',
    category: 'marketing',
    subject: 'You left something in your cart',
    body: `Hi {{name}}, you left some items in your cart at {{store_name}}. Pick up where you left off: {{cart_link}}${STOP}`,
  },
  'cart.reminder_2': {
    key: 'cart.reminder_2',
    category: 'marketing',
    subject: 'Your cart is still saved',
    body: `Hi {{name}}, your cart at {{store_name}} is still saved for you. Questions before you order? Reply here and we will help. {{cart_link}}${STOP}`,
  },
  'cart.reminder_3': {
    key: 'cart.reminder_3',
    category: 'marketing',
    subject: 'A last reminder about your cart',
    body: `Hi {{name}}, this is our last reminder about your cart at {{store_name}}. It stays saved here: {{cart_link}}${STOP}`,
  },
  'review.request': {
    key: 'review.request',
    category: 'marketing',
    subject: 'How did your order turn out?',
    body: `Hi {{name}}, how did your order {{order_number}} from {{store_name}} turn out? A short review helps other customers: {{review_link}}${STOP}`,
  },
  'stock.back_in_stock': {
    key: 'stock.back_in_stock',
    category: 'marketing',
    subject: '{{product_name}} is back in stock',
    body: `Good news: {{product_name}} is back in stock at {{store_name}}. See it here: {{product_link}}${STOP}`,
  },
  'lead.follow_up': {
    key: 'lead.follow_up',
    category: 'marketing',
    subject: 'Thank you for your interest in {{store_name}}',
    body: `Hi {{name}}, thank you for your interest in {{store_name}}. You can pick up where you left off here: {{link}} Reply to this message if you would like help from our team.${STOP}`,
  },
  'enquiry.received_admin': {
    key: 'enquiry.received_admin',
    category: 'utility',
    subject: 'New {{enquiry_type}} enquiry from {{name}}',
    body: 'New {{enquiry_type}} enquiry at {{store_name}} from {{name}} ({{phone}}). Open it in admin: {{admin_link}}',
  },
  'enquiry.received_customer': {
    key: 'enquiry.received_customer',
    category: 'utility',
    subject: 'We received your enquiry',
    body: 'Hi {{name}}, thank you for your {{enquiry_type}} enquiry. The {{store_name}} team will get back to you soon.',
  },
  'alert.critical': {
    key: 'alert.critical',
    category: 'utility',
    subject: 'Critical: {{title}}',
    body: 'Critical alert at {{store_name}}: {{title}}\n{{detail}}\nOpen: {{admin_link}}',
  },
  'alert.digest': {
    key: 'alert.digest',
    category: 'utility',
    subject: '{{store_name}} alerts: {{count}} open',
    body: '{{count}} open alerts at {{store_name}}.\n{{summary}}\nOpen: {{admin_link}}',
  },
  'staff.invite': {
    key: 'staff.invite',
    category: 'utility',
    subject: 'You are invited to the {{store_name}} admin',
    body: 'Hi {{name}}, you have been invited to the {{store_name}} admin as {{role}}. Set your password here: {{link}}\nIf you were not expecting this, ignore this message.',
  },
  'test.send': {
    key: 'test.send',
    category: 'utility',
    subject: 'Test message from {{store_name}}',
    body: 'This is a test message from {{store_name}}, sent at {{sent_at}}. If you can read this, the channel works.',
  },
};

const VAR_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

/** Variable names used in a template string, in order of first use. */
export function templateVariables(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of (t ?? '').matchAll(VAR_RE)) out.add(m[1]!);
  return [...out];
}

export class MissingTemplateVariableError extends Error {
  constructor(
    readonly key: string,
    readonly missing: readonly string[],
  ) {
    super(`template ${key}: missing variables ${missing.join(', ')}`);
    this.name = 'MissingTemplateVariableError';
  }
}

/** Replaces `{{name}}` placeholders. Every placeholder must have a value: a half-filled message is never sent. */
export function fillTemplate(key: string, text: string, vars: Readonly<Record<string, string | number>>): string {
  const missing = templateVariables(text).filter((v) => vars[v] === undefined || vars[v] === null);
  if (missing.length) throw new MissingTemplateVariableError(key, missing);
  return text.replace(VAR_RE, (_, name: string) => String(vars[name]));
}

/** WhatsApp template names allow lowercase letters, digits and underscores. */
export const whatsappTemplateName = (key: TemplateKey): string => key.replace(/\./g, '_');

export const isTemplateKey = (value: string): value is TemplateKey => (TEMPLATE_KEYS as readonly string[]).includes(value);

/** Minimal HTML for an email body: escaped text, line breaks, bare links made clickable. */
export function textToHtml(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const linked = escaped.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${linked
    .split('\n')
    .map((line) => `<p style="margin:0 0 12px">${line}</p>`)
    .join('')}</body></html>`;
}
