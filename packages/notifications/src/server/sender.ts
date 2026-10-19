import { TEMPLATE_KEYS, type ChannelId, type JobContext, type NotificationSender, type OutboundMessage, type Recipient, type TemplateKey } from '@ecomkit/core/contracts';
import { db, type DbOrTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { NotConfiguredError, integrationCall } from '@ecomkit/core/http';
import { newId } from '@ecomkit/core/ids';
import { enqueue } from '@ecomkit/core/jobs';
import { and, desc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { inServiceWindow, maskAddress, quietHoursRelease, SERVICE_WINDOW_MS, WA_PER_USER_MARKETING_LIMIT } from '../domain/rules';
import { STORE_NAME_VAR, type TemplateChannel } from '../domain/templates';
import { notificationsMessage, notificationsOptout, notificationsWebhookEvent } from '../schema';
import type { NotificationsSettings } from '../settings';
import { channelFor, createWhatsappChannel, type ChannelDeps, type ChannelResult } from './channels';
import { addressHash, loadSettings } from './config';
import { renderTemplate } from './templates';

export const DELIVER_JOB = 'notifications.deliver';
/** Delivery attempts before a retriable failure is recorded as failed (standard policy: 5 retries). */
export const DELIVER_RETRY_LIMIT = 5;

/** Admin-facing keys fall back to the admin email / phone from settings when no recipient is given. */
const ADMIN_KEYS = new Set<TemplateKey>(['enquiry.received_admin', 'alert.critical', 'alert.digest', 'test.send']);
const PROVIDER: Record<ChannelId, string> = { email: 'gmail', whatsapp: 'whatsapp', sms: 'sms', log: 'log' };

const varsSchema = z.record(z.string().regex(/^[a-z0-9_]+$/), z.union([z.string().max(2000), z.number()]));
const recipientSchema = z.object({ customerId: z.string().nullish(), phone: z.string().max(32).nullish(), email: z.email().nullish() });

export interface SendOptions {
  channel?: ChannelId;
  tx?: unknown;
  orderId?: string | null;
  flowRunId?: string | null;
  isTest?: boolean;
  /** Test hook. */
  now?: Date;
}

export interface DeliverJobData {
  messageId: string;
  message: OutboundMessage;
}

function isTx(value: unknown): value is Tx {
  return typeof value === 'object' && value !== null && typeof (value as { execute?: unknown }).execute === 'function';
}

function pickChannels(to: Recipient, s: NotificationsSettings, explicit?: ChannelId): { channel: ChannelId; address: string }[] {
  const phone = to.phone?.trim() || null;
  const email = to.email?.trim() || null;
  if (explicit) {
    const address = explicit === 'email' ? email : explicit === 'log' ? (email ?? phone) : phone;
    if (!address) throw new Error(`notifications: no ${explicit === 'email' ? 'email' : 'phone'} for channel ${explicit}`);
    return [{ channel: explicit, address }];
  }
  const out: { channel: ChannelId; address: string }[] = [];
  if (email && s.emailMode !== 'off') out.push({ channel: 'email', address: email });
  if (phone && s.whatsappMode !== 'off') out.push({ channel: 'whatsapp', address: phone });
  // Nothing enabled for this recipient: keep a record in the log channel rather than drop it silently.
  if (!out.length && (email ?? phone)) out.push({ channel: 'log', address: (email ?? phone)! });
  return out;
}

/** Why a message is not sent, checked when it is queued. */
async function skipReason(key: TemplateKey, category: string, channel: ChannelId, toHash: string, s: NotificationsSettings, now: Date, dbOrTx: DbOrTx): Promise<string | null> {
  if (key.startsWith('otp.') && s.otpKillSwitch) return 'otp_disabled';
  if (category !== 'marketing' || (channel !== 'whatsapp' && channel !== 'sms')) return null;
  const [opt] = await dbOrTx.select({ h: notificationsOptout.phoneHash }).from(notificationsOptout).where(eq(notificationsOptout.phoneHash, toHash));
  if (opt) return 'opted_out';
  if (channel === 'whatsapp') {
    const since = new Date(now.getTime() - SERVICE_WINDOW_MS);
    const [limited] = await dbOrTx
      .select({ id: notificationsMessage.id })
      .from(notificationsMessage)
      .where(and(eq(notificationsMessage.toHash, toHash), eq(notificationsMessage.errorCode, String(WA_PER_USER_MARKETING_LIMIT)), gt(notificationsMessage.updatedAt, since)))
      .limit(1);
    if (limited) return 'per_user_limit_24h';
  }
  return null;
}

/**
 * Renders and queues a template message on every channel the recipient can be reached on (or the one asked for).
 * Writes the log row and the delivery job together (inside `options.tx` when given, so nothing is sent for a
 * rolled-back order). Opt-outs, the OTP kill switch and the per-user marketing limit are checked here; marketing
 * messages queued in quiet hours are held until they end.
 */
export async function send(templateKey: TemplateKey, to: Recipient, vars: Readonly<Record<string, string | number>>, options: SendOptions = {}): Promise<{ messageIds: string[] }> {
  const { messageIds } = await queueMessages(templateKey, to, vars, options);
  return { messageIds };
}

/** `send` that also returns the queued jobs (the settings test actions deliver them straight away). */
export async function queueMessages(templateKey: TemplateKey, to: Recipient, vars: Readonly<Record<string, string | number>>, options: SendOptions = {}): Promise<{ messageIds: string[]; queued: DeliverJobData[] }> {
  if (!(TEMPLATE_KEYS as readonly string[]).includes(templateKey)) throw new Error(`notifications: unknown template key "${templateKey}"`);
  const recipient = recipientSchema.parse(to);
  const input = varsSchema.parse(vars);
  if (options.tx !== undefined && !isTx(options.tx)) throw new TypeError('notifications.send: tx must be a Drizzle transaction');
  const tx = options.tx as Tx | undefined;
  const dbOrTx: DbOrTx = tx ?? db;
  const s = await loadSettings();
  const now = options.now ?? new Date();
  const target = ADMIN_KEYS.has(templateKey) && !recipient.email && !recipient.phone ? { email: s.adminEmail || null, phone: s.adminPhone || null } : recipient;
  const allVars = { ...input, [STORE_NAME_VAR]: s.storeName };

  const messageIds: string[] = [];
  const queued: DeliverJobData[] = [];
  for (const { channel, address } of pickChannels(target, s, options.channel)) {
    const templateChannel: TemplateChannel = channel === 'log' ? 'email' : channel;
    const r = await renderTemplate(templateKey, templateChannel, allVars, dbOrTx);
    const category = r.template.category;
    const toHash = addressHash(address);
    const reason = await skipReason(templateKey, category, channel, toHash, s, now, dbOrTx);
    const id = newId();
    const whatsapp = channel === 'whatsapp' ? { templateName: r.template.metaTemplateName, language: s.whatsappLanguage, category, params: r.params } : null;
    await dbOrTx.insert(notificationsMessage).values({
      id,
      channel,
      templateKey,
      category,
      toHash,
      toMasked: maskAddress(address),
      rendered: { subject: channel === 'email' || channel === 'log' ? r.subject : null, text: r.text, whatsapp, templateVersion: r.template.version },
      status: reason ? 'skipped' : 'queued',
      error: reason,
      orderId: options.orderId ?? null,
      flowRunId: options.flowRunId ?? null,
      isTest: options.isTest ?? templateKey === 'test.send',
      queuedAt: now,
      updatedAt: now,
    });
    messageIds.push(id);
    if (reason) continue;
    const message: OutboundMessage = { messageId: id, channel, to: address, templateKey, locale: 'en-IN', subject: r.subject, text: r.text, html: channel === 'email' || channel === 'log' ? r.html : null, whatsapp };
    const release = quietHoursRelease(now, category, { start: s.quietHoursStart, end: s.quietHoursEnd });
    await enqueue(DELIVER_JOB, { messageId: id, message } satisfies DeliverJobData, { ...(tx ? { tx } : {}), ...(release ? { startAfter: release } : {}) });
    queued.push({ messageId: id, message });
  }
  return { messageIds, queued };
}

/** The `notifications` service (contract NotificationSender). */
export const sender: NotificationSender = { send: (key, to, vars, options) => send(key, to, vars, options) };

class ChannelFailure extends Error {
  constructor(readonly result: ChannelResult) {
    super(result.error ?? 'send failed');
    this.name = 'ChannelFailure';
  }
}

/**
 * Job `notifications.deliver`: sends one queued message through its channel adapter and records the outcome.
 * Idempotent (a message that is no longer queued is left alone). Retriable failures (rate limits, 5xx, throughput)
 * throw so the queue retries with backoff; the last attempt, and every permanent failure, marks the row failed.
 */
export async function deliver(data: DeliverJobData, ctx: Pick<JobContext, 'attempt'> = { attempt: 1 }, deps: ChannelDeps = {}): Promise<ChannelResult | null> {
  const [row] = await db.select().from(notificationsMessage).where(eq(notificationsMessage.id, data.messageId));
  if (!row || row.status !== 'queued') return null;
  const s = await loadSettings();
  const channel = channelFor(data.message.channel, s, deps);
  const call = await integrationCall(
    PROVIDER[data.message.channel],
    'send',
    async () => {
      const result = await channel.send(data.message);
      if (result.status === 'skipped_not_configured') throw new NotConfiguredError(PROVIDER[data.message.channel]);
      if (result.status === 'failed') throw new ChannelFailure(result);
      return result;
    },
    { ref: data.messageId },
  );
  const now = new Date();
  const base = { channel: row.channel, messageId: row.id, templateKey: row.templateKey };

  if (call.status === 'ok') {
    await db.update(notificationsMessage).set({ status: 'sent', providerMessageId: call.value.providerMessageId, sentAt: now, updatedAt: now, error: null, errorCode: null }).where(eq(notificationsMessage.id, row.id));
    await emit('message.sent', base);
    return call.value;
  }
  if (call.status === 'skipped_not_configured') {
    await db.update(notificationsMessage).set({ status: 'skipped', error: 'not_configured', updatedAt: now }).where(eq(notificationsMessage.id, row.id));
    return { status: 'skipped_not_configured', providerMessageId: null, error: 'not_configured' };
  }
  const result = call.error instanceof ChannelFailure ? call.error.result : { status: 'failed' as const, providerMessageId: null, error: call.error.message, failure: 'retry' as const, errorCode: null };
  const retry = result.failure === 'retry' && ctx.attempt <= DELIVER_RETRY_LIMIT;
  await db
    .update(notificationsMessage)
    .set({ ...(retry ? {} : { status: 'failed' as const }), error: result.error, errorCode: result.errorCode ?? null, updatedAt: now })
    .where(eq(notificationsMessage.id, row.id));
  if (retry) throw new Error(`notifications: retrying ${row.id}: ${result.error}`);
  await emit('message.failed', { ...base, error: result.error ?? 'failed' });
  return result;
}

export const deliverJob = (data: DeliverJobData, ctx: JobContext) => deliver(data, ctx).then(() => undefined);

// ---- free-form WhatsApp inside the service window --------------------------------------------------
/** When this number last messaged us (inbound webhook), or null. */
export async function lastInboundAt(phone: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: notificationsWebhookEvent.receivedAt })
    .from(notificationsWebhookEvent)
    .where(and(eq(notificationsWebhookEvent.phoneHash, addressHash(phone)), eq(notificationsWebhookEvent.kind, 'inbound')))
    .orderBy(desc(notificationsWebhookEvent.receivedAt))
    .limit(1);
  return row?.at ?? null;
}

/**
 * Sends free-form text (no template) to a number that messaged us in the last 24 h. Outside the window the
 * message is not sent (`skipped`, reason `outside_service_window`): use a template instead.
 */
export async function sendSessionText(phone: string, text: string, deps: ChannelDeps & { now?: Date } = {}): Promise<{ messageId: string; status: 'sent' | 'failed' | 'skipped'; error: string | null }> {
  const s = await loadSettings();
  const now = deps.now ?? new Date();
  const toHash = addressHash(phone);
  const id = newId();
  const open = inServiceWindow(await lastInboundAt(phone), now);
  const result: ChannelResult = open ? await createWhatsappChannel(s, deps).sendText(phone, text) : { status: 'failed', providerMessageId: null, error: 'outside_service_window' };
  const status = !open || result.status === 'skipped_not_configured' ? 'skipped' : result.status === 'sent' ? 'sent' : 'failed';
  await db.insert(notificationsMessage).values({
    id,
    channel: 'whatsapp',
    templateKey: 'session.text',
    category: 'utility',
    toHash,
    toMasked: maskAddress(phone),
    rendered: { subject: null, text, whatsapp: null },
    status,
    providerMessageId: result.providerMessageId,
    error: open ? result.error : 'outside_service_window',
    errorCode: result.errorCode ?? null,
    queuedAt: now,
    sentAt: status === 'sent' ? now : null,
    updatedAt: now,
  });
  return { messageId: id, status, error: open ? result.error : 'outside_service_window' };
}
