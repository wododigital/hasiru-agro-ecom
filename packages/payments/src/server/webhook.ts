// POST /api/webhooks/phonepe: verify, store once, queue. The job then asks the gateway for the real state;
// the webhook body is only a hint (never marks anything paid by itself).
import { db, withTx } from '@ecomkit/core/db';
import { clientIp, hashIp, PayloadTooLargeError, readRawBody } from '@ecomkit/core/http';
import { newId } from '@ecomkit/core/ids';
import { enqueue } from '@ecomkit/core/jobs';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { and, eq, gt, sql } from 'drizzle-orm';
import { webhookBody } from '../domain';
import { paymentsAttempt, paymentsRefund, paymentsWebhookEvent } from '../schema';
import { loadSettings } from './config';
import { syncAttempt, syncRefund } from './payments';
import { phonepeProvider } from './phonepe';
import { alertPort } from './ports';

export const WEBHOOK_JOB = 'payments.process-webhook';
const MAX_BODY = 64 * 1024;
/** Rejected signatures in 10 minutes that raise the critical alert. */
const BAD_SIGNATURE_ALERT_AT = 3;

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

async function noteRejected(now: Date): Promise<void> {
  await db.insert(paymentsWebhookEvent).values({ provider: 'phonepe', event: null, dedupeKey: `rejected:${newId()}`, payload: null, signatureOk: false, receivedAt: now });
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentsWebhookEvent)
    .where(and(eq(paymentsWebhookEvent.signatureOk, false), gt(paymentsWebhookEvent.receivedAt, new Date(now.getTime() - 10 * 60_000))));
  const send = alertPort();
  if (send && (row?.n ?? 0) >= BAD_SIGNATURE_ALERT_AT) {
    await send({
      rule: 'payments.webhook_signature',
      fingerprint: 'phonepe',
      severity: 'critical',
      title: 'Payment webhooks failing authentication',
      body: `${row!.n} payment webhooks in the last 10 minutes had a wrong Authorization header. Check the webhook username and password in payment settings and on the gateway dashboard.`,
    }).catch(() => undefined);
  }
}

export async function receiveWebhook(req: Request): Promise<Response> {
  const limited = await rateLimit(`webhook-phonepe:${hashIp(clientIp(req)) ?? 'unknown'}`, { limit: 600, windowSec: 60 });
  if (!limited.ok) return json(429, { ok: false });
  let raw: string;
  try {
    raw = (await readRawBody(req, MAX_BODY)).toString('utf8');
  } catch (err) {
    return json(err instanceof PayloadTooLargeError ? 413 : 400, { ok: false });
  }
  const s = await loadSettings();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => void (headers[k.toLowerCase()] = v));
  const result = await phonepeProvider(s, s.mode).handleWebhook!({ rawBody: raw, headers });
  if (!result.verified) {
    await noteRejected(new Date());
    return json(401, { ok: false });
  }
  if (!result.eventId) return json(200, { ok: true, ignored: true });
  const dedupeKey = result.eventId;
  await withTx(async (tx) => {
    const [row] = await tx
      .insert(paymentsWebhookEvent)
      .values({ provider: 'phonepe', event: result.event, dedupeKey, payload: JSON.parse(raw) as Record<string, unknown>, signatureOk: true })
      .onConflictDoNothing({ target: paymentsWebhookEvent.dedupeKey })
      .returning({ id: paymentsWebhookEvent.id });
    if (row) await enqueue(WEBHOOK_JOB, { eventId: row.id }, { tx });
  });
  return json(200, { ok: true });
}

/** Job: resolve the attempt or refund the event is about and reconcile it through the status API. Runs once per stored event. */
export async function processWebhookEvent(eventId: string): Promise<'processed' | 'skipped' | 'unknown_ref'> {
  const [ev] = await db.select().from(paymentsWebhookEvent).where(eq(paymentsWebhookEvent.id, eventId));
  if (!ev || ev.processedAt || !ev.signatureOk) return 'skipped';
  const parsed = webhookBody.safeParse(ev.payload);
  const p = parsed.success ? parsed.data.payload : {};
  let outcome: 'processed' | 'unknown_ref' = 'unknown_ref';
  let error: string | null = null;
  if ((ev.event ?? '').startsWith('pg.refund.')) {
    const [r] = p.merchantRefundId ? await db.select({ id: paymentsRefund.id }).from(paymentsRefund).where(eq(paymentsRefund.merchantRefundId, p.merchantRefundId)) : [];
    if (r) {
      const res = await syncRefund(r.id);
      if (!res.ok) throw new Error(`refund status check failed: ${res.reason}`); // retried by the job policy
      outcome = 'processed';
    }
  } else {
    const ref = p.merchantOrderId ?? p.originalMerchantOrderId;
    const [a] = ref ? await db.select({ id: paymentsAttempt.id }).from(paymentsAttempt).where(eq(paymentsAttempt.merchantOrderId, ref)) : [];
    if (a) {
      const res = await syncAttempt(a.id);
      if (!res.ok) throw new Error(`status check failed: ${res.reason}`);
      outcome = 'processed';
    }
  }
  if (outcome === 'unknown_ref') error = 'no matching attempt or refund';
  await db.update(paymentsWebhookEvent).set({ processedAt: new Date(), error }).where(eq(paymentsWebhookEvent.id, ev.id));
  return outcome;
}

export const processWebhookJob = async (data: { eventId: string }): Promise<void> => {
  await processWebhookEvent(data.eventId);
};
