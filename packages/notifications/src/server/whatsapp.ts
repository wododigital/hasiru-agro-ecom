import { TEMPLATE_KEYS } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { integrationCall, readRawBody, timingSafeEqual, verifyHmacSha256 } from '@ecomkit/core/http';
import { enqueue } from '@ecomkit/core/jobs';
import { createLogger } from '@ecomkit/core/observability';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { asc, eq, isNull, inArray } from 'drizzle-orm';
import { nextStatus, optKeyword, type MessageStatus } from '../domain/rules';
import { templateCreatePayload, templateStatus, webhookItems, type WebhookItem } from '../domain/whatsapp';
import { notificationsMessage, notificationsOptout, notificationsWebhookEvent, notificationsWhatsappTemplate } from '../schema';
import { graph, whatsappConfig } from './channels';
import { addressHash, loadSettings, type Http } from './config';
import { resolveTemplate } from './templates';

export const PROCESS_WEBHOOK_JOB = 'notifications.process-webhook';
const log = createLogger('notifications.whatsapp');

// ---- webhook route: GET /api/webhooks/whatsapp (verify), POST (events) ------------------------------
export async function verifyWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cfg = whatsappConfig(await loadSettings());
  const token = url.searchParams.get('hub.verify_token') ?? '';
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  if (!cfg?.verifyToken || url.searchParams.get('hub.mode') !== 'subscribe' || !timingSafeEqual(token, cfg.verifyToken)) return new Response(null, { status: 403 });
  return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
}

/**
 * Stores each update first (unique dedupe key: wamid + status, inbound wamid, template event), then queues
 * processing. Signature is HMAC-SHA256 of the raw body with the app secret. Always 200 for a valid signature
 * so Meta does not retry what we already have.
 */
export async function receiveWebhook(req: Request): Promise<Response> {
  const limit = await rateLimit('whatsapp-webhook:meta', { limit: 600, windowSec: 60 });
  if (!limit.ok) return new Response(null, { status: 429 });
  let raw: Buffer;
  try {
    raw = await readRawBody(req, 2 * 1024 * 1024);
  } catch {
    return new Response(null, { status: 413 });
  }
  const cfg = whatsappConfig(await loadSettings());
  if (!cfg?.appSecret || !verifyHmacSha256(raw, req.headers.get('x-hub-signature-256'), cfg.appSecret)) return new Response(null, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return new Response(null, { status: 400 });
  }
  const stored = await storeWebhookItems(webhookItems(body));
  if (stored) await enqueue(PROCESS_WEBHOOK_JOB, {});
  return Response.json({ received: stored });
}

/** Inserts items, skipping duplicates. Returns how many were new. */
export async function storeWebhookItems(items: WebhookItem[]): Promise<number> {
  if (!items.length) return 0;
  const rows = items.map((item) => ({
    provider: 'whatsapp',
    dedupeKey: item.dedupeKey,
    kind: item.kind,
    phoneHash: item.kind === 'inbound' ? addressHash(item.from) : null,
    payload: item.data as unknown as Record<string, unknown>,
  }));
  const inserted = await db.insert(notificationsWebhookEvent).values(rows).onConflictDoNothing({ target: notificationsWebhookEvent.dedupeKey }).returning({ id: notificationsWebhookEvent.id });
  return inserted.length;
}

// ---- processing (job) ------------------------------------------------------------------------------
const STATUS_MAP: Record<string, MessageStatus | undefined> = { sent: 'sent', delivered: 'delivered', read: 'read', played: 'read', failed: 'failed' };

/** Job `notifications.process-webhook`: applies stored, unprocessed updates in arrival order. Safe to run concurrently. */
export async function processWebhookEvents(batch = 500): Promise<number> {
  let done = 0;
  for (;;) {
    const n = await db.transaction(async (tx) => {
      const rows = await tx.select().from(notificationsWebhookEvent).where(isNull(notificationsWebhookEvent.processedAt)).orderBy(asc(notificationsWebhookEvent.receivedAt)).limit(batch).for('update', { skipLocked: true });
      for (const row of rows) {
        const p = row.payload as Record<string, unknown>;
        if (row.kind === 'status') {
          const status = STATUS_MAP[String(p.status)];
          const [msg] = status ? await tx.select().from(notificationsMessage).where(eq(notificationsMessage.providerMessageId, String(p.id))) : [];
          if (msg && status) {
            const next = nextStatus(msg.status, status);
            const err = (p.errors as { code?: number; title?: string; error_data?: { details?: string } }[] | undefined)?.[0];
            await tx
              .update(notificationsMessage)
              .set({
                status: next,
                ...(p.pricing ? { pricing: p.pricing } : {}),
                ...(status === 'failed' ? { errorCode: err?.code !== undefined ? String(err.code) : null, error: err?.error_data?.details ?? err?.title ?? 'failed' } : {}),
                updatedAt: new Date(),
              })
              .where(eq(notificationsMessage.id, msg.id));
            if (status === 'failed' && msg.status !== 'failed') await emit('message.failed', { messageId: msg.id, channel: msg.channel, templateKey: msg.templateKey, error: err?.title ?? 'failed' }, { tx });
          }
        } else if (row.kind === 'inbound' && row.phoneHash) {
          const text = (p.text as { body?: string } | undefined)?.body ?? (p.button as { text?: string } | undefined)?.text ?? '';
          const kw = optKeyword(text);
          if (kw === 'stop') await tx.insert(notificationsOptout).values({ phoneHash: row.phoneHash, channel: 'whatsapp', reason: 'stop_keyword' }).onConflictDoNothing();
          if (kw === 'start') await tx.delete(notificationsOptout).where(eq(notificationsOptout.phoneHash, row.phoneHash));
        } else if (row.kind === 'template') {
          const status = templateStatus(String(p.event));
          if (status) await tx.update(notificationsWhatsappTemplate).set({ status, ...(p.message_template_id ? { metaId: String(p.message_template_id) } : {}) }).where(eq(notificationsWhatsappTemplate.name, String(p.message_template_name)));
        }
        await tx.update(notificationsWebhookEvent).set({ processedAt: new Date() }).where(eq(notificationsWebhookEvent.id, row.id));
      }
      return rows.length;
    });
    done += n;
    if (n < batch) return done;
  }
}

export const processWebhookJob = () => processWebhookEvents().then(() => undefined);

// ---- template sync and submission --------------------------------------------------------------------
type RemoteTemplate = { id?: string; name: string; status?: string; category?: string; language?: string; components?: unknown[] };
const CATEGORY = { UTILITY: 'utility', MARKETING: 'marketing', AUTHENTICATION: 'authentication' } as const;

/** Pulls every template on the WhatsApp Business Account into notifications_whatsapp_template. */
export async function syncWhatsappTemplates(http?: Http): Promise<{ ok: boolean; count: number; message: string }> {
  const cfg = whatsappConfig(await loadSettings());
  if (!cfg?.wabaId) return { ok: false, count: 0, message: 'WhatsApp is off or the account ID is missing.' };
  const call = await integrationCall('whatsapp', 'templates.sync', async () => {
    const all: RemoteTemplate[] = [];
    let path: string | null = `${cfg.wabaId}/message_templates?limit=250&fields=id,name,status,category,language,components`;
    for (let page = 0; path && page < 20; page++) {
      const r = await graph(cfg, path, {}, http);
      if (!r.ok) throw new Error(`whatsapp ${r.status}: ${r.json.error?.message ?? 'template list failed'}`);
      all.push(...((r.json.data as RemoteTemplate[] | undefined) ?? []));
      const after = (r.json.paging as { cursors?: { after?: string }; next?: string } | undefined)?.cursors?.after;
      path = (r.json.paging as { next?: string } | undefined)?.next && after ? `${cfg.wabaId}/message_templates?limit=250&fields=id,name,status,category,language,components&after=${encodeURIComponent(after)}` : null;
    }
    return all;
  });
  if (call.status !== 'ok') return { ok: false, count: 0, message: call.status === 'failed' ? call.error.message : 'not configured' };
  const now = new Date();
  for (const t of call.value) {
    const values = {
      name: t.name,
      category: CATEGORY[(t.category ?? 'UTILITY').toUpperCase() as keyof typeof CATEGORY] ?? 'utility',
      language: t.language ?? 'en',
      status: templateStatus(t.status ?? 'PENDING') ?? 'pending',
      components: t.components ?? [],
      metaId: t.id ?? null,
      lastSyncedAt: now,
    };
    await db.insert(notificationsWhatsappTemplate).values(values).onConflictDoUpdate({ target: notificationsWhatsappTemplate.name, set: { ...values } });
  }
  return { ok: true, count: call.value.length, message: `Synced ${call.value.length} templates.` };
}

/**
 * Submits every store template that is not yet on the account (or was rejected) for review.
 * Meta reviews within 24 h; status changes come back by webhook and by the daily sync.
 */
export async function submitWhatsappTemplates(http?: Http): Promise<{ ok: boolean; submitted: string[]; message: string }> {
  const s = await loadSettings();
  const cfg = whatsappConfig(s);
  if (!cfg?.wabaId) return { ok: false, submitted: [], message: 'WhatsApp is off or the account ID is missing.' };
  const existing = await db.select().from(notificationsWhatsappTemplate);
  const submitted: string[] = [];
  const errors: string[] = [];
  for (const key of TEMPLATE_KEYS) {
    const t = await resolveTemplate(key, 'whatsapp');
    const known = existing.find((e) => e.name === t.metaTemplateName);
    if (known && known.status !== 'rejected' && known.status !== 'draft') continue;
    const payload = templateCreatePayload(t.metaTemplateName, t.category, s.whatsappLanguage, t.body);
    const call = await integrationCall('whatsapp', 'templates.create', async () => {
      const r = await graph(cfg, `${cfg.wabaId}/message_templates`, { method: 'POST', body: payload }, http);
      if (!r.ok) throw new Error(`${t.metaTemplateName}: ${r.json.error?.message ?? r.status}`);
      return r.json as { id?: string; status?: string };
    });
    if (call.status !== 'ok') {
      errors.push(call.status === 'failed' ? call.error.message : t.metaTemplateName);
      continue;
    }
    const values = { name: t.metaTemplateName, category: t.category, language: s.whatsappLanguage, status: templateStatus(call.value.status ?? 'PENDING') ?? 'pending', components: (payload.components as unknown[]) ?? [], metaId: call.value.id ?? null, lastSyncedAt: new Date() };
    await db.insert(notificationsWhatsappTemplate).values(values).onConflictDoUpdate({ target: notificationsWhatsappTemplate.name, set: values });
    submitted.push(t.metaTemplateName);
  }
  if (errors.length) log.warn('template submission errors', { errors });
  return { ok: errors.length === 0, submitted, message: errors.length ? `Submitted ${submitted.length}; ${errors.length} failed: ${errors.slice(0, 3).join('; ')}` : `Submitted ${submitted.length} templates for review.` };
}

/** Templates whose remote status blocks sending (for the health check). */
export async function blockedTemplates(): Promise<string[]> {
  const rows = await db.select({ name: notificationsWhatsappTemplate.name }).from(notificationsWhatsappTemplate).where(inArray(notificationsWhatsappTemplate.status, ['rejected', 'paused', 'disabled']));
  return rows.map((r) => r.name);
}
