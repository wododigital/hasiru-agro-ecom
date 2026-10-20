// Scheduled reconciliation: the poll (status checks on open attempts and refunds, backing off on 429) and the
// sweep (expires attempts past their window and hands unpaid orders to the orders hook). Both run every minute.
import { db, withTx } from '@ecomkit/core/db';
import { and, asc, desc, eq, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { backoffSec, pollDelaySec } from '../domain';
import { paymentsAttempt, paymentsRefund, paymentsWebhookEvent } from '../schema';
import { loadSettings } from './config';
import { applyPaymentState, syncAttempt, syncRefund } from './payments';
import { ordersPort } from './ports';

const BATCH = 50;
/** Without a gateway answer, a pending attempt is expired anyway this long after its window. */
const EXPIRE_WITHOUT_ANSWER_MS = 10 * 60_000;

const g = globalThis as unknown as { __ecomkitPay429?: number };

/** One poll run. Stops at the first 429 and pushes the rest back (the gateway rate-limits the status API). */
export async function pollPending(options: { now?: Date } = {}): Promise<{ checked: number; rateLimited: boolean }> {
  const now = options.now ?? new Date();
  let checked = 0;
  const backOff = async (table: typeof paymentsAttempt | typeof paymentsRefund, ids: string[]) => {
    g.__ecomkitPay429 = (g.__ecomkitPay429 ?? 0) + 1;
    const at = new Date(now.getTime() + backoffSec(g.__ecomkitPay429) * 1000);
    if (ids.length) await db.update(table).set({ nextPollAt: at }).where(inArray(table.id, ids));
    return { checked, rateLimited: true };
  };

  const attempts = await db
    .select()
    .from(paymentsAttempt)
    .where(and(eq(paymentsAttempt.state, 'pending'), ne(paymentsAttempt.provider, 'bank_transfer'), lte(paymentsAttempt.nextPollAt, now)))
    .orderBy(asc(paymentsAttempt.nextPollAt))
    .limit(BATCH);
  for (const [i, a] of attempts.entries()) {
    const res = await syncAttempt(a.id, { now });
    if (!res.ok && res.reason === 'rate_limited') return backOff(paymentsAttempt, attempts.slice(i).map((x) => x.id));
    checked++;
    g.__ecomkitPay429 = 0;
    if (!res.ok || res.attempt.state === 'pending') {
      const age = (now.getTime() - a.createdAt.getTime()) / 1000;
      await db
        .update(paymentsAttempt)
        .set({ nextPollAt: new Date(now.getTime() + pollDelaySec(age) * 1000), pollCount: sql`${paymentsAttempt.pollCount} + 1` })
        .where(and(eq(paymentsAttempt.id, a.id), eq(paymentsAttempt.state, 'pending')));
    }
  }

  const refunds = await db
    .select()
    .from(paymentsRefund)
    .where(and(eq(paymentsRefund.state, 'pending'), lte(paymentsRefund.nextPollAt, now)))
    .orderBy(asc(paymentsRefund.nextPollAt))
    .limit(BATCH);
  for (const [i, r] of refunds.entries()) {
    const res = await syncRefund(r.id);
    if (!res.ok && res.reason === 'rate_limited') return backOff(paymentsRefund, refunds.slice(i).map((x) => x.id));
    checked++;
    if (!res.ok || res.refund.state === 'pending') await db.update(paymentsRefund).set({ nextPollAt: new Date(now.getTime() + 60_000) }).where(eq(paymentsRefund.id, r.id));
  }
  return { checked, rateLimited: false };
}

/**
 * One sweep run:
 * 1. pending attempts past their window get a last status check; still pending (or no answer 10 min on) -> expired;
 * 2. orders whose window is over with nothing open or applied -> `orders.paymentExpired` (cancel, release stock,
 *    `order.payment_failed`), once per order;
 * 3. orders that never reached the pay step -> `orders.sweepWithoutAttempt` (when the orders module provides it).
 */
export async function sweep(options: { now?: Date } = {}): Promise<{ expired: number; closedOrders: number; withoutAttempt: number }> {
  const now = options.now ?? new Date();
  let expired = 0;
  const due = await db
    .select()
    .from(paymentsAttempt)
    .where(and(eq(paymentsAttempt.state, 'pending'), lte(paymentsAttempt.expiresAt, now)))
    .orderBy(asc(paymentsAttempt.expiresAt))
    .limit(BATCH);
  for (const a of due) {
    let raw: unknown = undefined;
    if (a.provider !== 'bank_transfer') {
      const res = await syncAttempt(a.id, { now });
      if (res.ok && res.attempt.state !== 'pending') continue;
      if (!res.ok && now.getTime() - a.expiresAt.getTime() < EXPIRE_WITHOUT_ANSWER_MS) continue;
      raw = res.ok ? res.attempt.rawStatus : undefined;
    }
    const applied = await applyPaymentState(a.id, { state: 'expired', amountPaise: null, raw }, { now });
    if (applied?.decision.next === 'expired') expired++;
  }

  const open = sql`exists (select 1 from payments_attempt b where b.order_id = ${paymentsAttempt.orderId} and (b.state = 'pending' or b.applied_at is not null))`;
  const orderIds = await db
    .selectDistinct({ orderId: paymentsAttempt.orderId })
    .from(paymentsAttempt)
    .where(and(sql`${paymentsAttempt.sweptAt} is null`, lte(paymentsAttempt.expiresAt, now), sql`not ${open}`))
    .limit(BATCH);
  const orders = ordersPort();
  for (const { orderId } of orderIds) {
    await withTx(async (tx) => {
      const attempts = await tx.select().from(paymentsAttempt).where(eq(paymentsAttempt.orderId, orderId)).orderBy(desc(paymentsAttempt.attemptNo)).for('update');
      if (attempts.some((a) => a.state === 'pending' || a.appliedAt) || attempts.every((a) => a.sweptAt)) return;
      await orders.paymentExpired({ orderId, reason: attempts[0]?.state === 'failed' ? 'failed' : 'expired' }, { tx });
      await tx.update(paymentsAttempt).set({ sweptAt: now }).where(eq(paymentsAttempt.orderId, orderId));
    });
  }

  let withoutAttempt = 0;
  if (orders.sweepWithoutAttempt) {
    const s = await loadSettings();
    withoutAttempt = await orders.sweepWithoutAttempt(new Date(now.getTime() - s.attemptExpiryMinutes * 60_000));
  }

  // Rejected webhooks are kept a week for the signature alert and investigation.
  await db.delete(paymentsWebhookEvent).where(and(eq(paymentsWebhookEvent.signatureOk, false), lt(paymentsWebhookEvent.receivedAt, new Date(now.getTime() - 7 * 86_400_000))));
  return { expired, closedOrders: orderIds.length, withoutAttempt };
}

export const pollJob = async (): Promise<void> => void (await pollPending());
export const sweepJob = async (): Promise<void> => void (await sweep());
