import type { Locale } from './common';
import type { SettingsActionResult } from './extensions';

/** Template keys (frozen catalogue, see docs/CONVENTIONS.md). */
export const TEMPLATE_KEYS = [
  'otp.login',
  'otp.unlock',
  'order.confirmed',
  'order.packed',
  'order.dispatched',
  'order.delivered',
  'order.payment_failed',
  'order.replacement_created',
  'slot.reminder',
  'cart.reminder_1',
  'cart.reminder_2',
  'cart.reminder_3',
  'review.request',
  'stock.back_in_stock',
  'lead.follow_up',
  'enquiry.received_admin',
  'enquiry.received_customer',
  'alert.critical',
  'alert.digest',
  'staff.invite',
  'test.send',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type ChannelId = 'email' | 'whatsapp' | 'sms' | 'log';

export interface OutboundMessage {
  messageId: string;
  channel: ChannelId;
  /** E.164 phone for whatsapp/sms, address for email. */
  to: string;
  templateKey: TemplateKey;
  locale: Locale;
  subject: string | null;
  text: string;
  html: string | null;
  whatsapp: {
    templateName: string;
    language: string;
    category: 'utility' | 'authentication' | 'marketing';
    params: Readonly<Record<string, string>>;
  } | null;
}

export type SendStatus = 'sent' | 'queued' | 'failed' | 'skipped_not_configured' | 'skipped_opt_out' | 'skipped_quiet_hours';

export interface SendResult {
  status: SendStatus;
  providerMessageId: string | null;
  error: string | null;
}

/** One adapter per transport (gmail -> email, whatsapp cloud, sms_mock, log). */
export interface NotificationChannel {
  id: ChannelId;
  adapter: string;
  send(message: OutboundMessage): Promise<SendResult>;
  testConnection?(): Promise<SettingsActionResult>;
}

export interface Recipient {
  customerId?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Service key `notifications`, provided by `@ecomkit/notifications`. Renders the template, applies opt-out and quiet hours, logs. */
export interface NotificationSender {
  send(
    templateKey: TemplateKey,
    to: Recipient,
    vars: Readonly<Record<string, string | number>>,
    options?: { channel?: ChannelId; tx?: unknown },
  ): Promise<{ messageIds: string[] }>;
}
