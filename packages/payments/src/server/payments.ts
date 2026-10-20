// Attempts, the single state application path (applyPaymentState), refunds and offline payments.
// Every signal (return page, webhook, poll, sweep, staff) ends in applyPaymentState after a server-side
// status check; nothing is marked paid from a redirect or a webhook body.
import type { Paise, PaymentState } from '@ecomkit/core/contracts';
import { audit } from '@ecomkit/core/audit';
import { db, withTx, type Tx } from '@ecomkit/core/db';
import { integrationCall } from '@ecomkit/core/http';
import { captureError } from '@ecomkit/core/observability';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  advancePaise,
  decide,
  merchantOrderId,
  merchantRefundId,
  MIN_ONLINE_PAISE,
  refundable,
  type Anomaly,
  type CheckoutPaymentOption,
  type Decision,
  type PaymentMethod,
} from '../domain';
import { paymentsAttempt, paymentsRefund, type PaymentAttemptRow, type PaymentRefundRow } from '../schema';
import type { PaymentsSettings } from '../settings';
import { loadSettings, publicOrigin } from './config';
import { GatewayError, phonepeProvider, type GatewayProvider } from './phonepe';
import { alertPort, ordersPort, type PaymentsAlert } from './ports';

const MIN_WINDOW_LEFT_MS = 5 * 60_000; // the gateway's shortest expiry
const FIRST_POLL_MS = 20_000;

/** The adapter for an attempt's provider; null for offline money (bank transfer), which has no status API. */
export function providerFor(provider: PaymentAttemptRow['provider'], s: PaymentsSettings): GatewayProvider | null {
  if (provider === 'bank_transfer') return null;
  if (provider === 'mock') return phonepeProvider(s, 'mock');
  return phonepeProvider(s, s.mode === 'mock' ? 'sandbox' : s.mode);
}

/** Money the gateway (or staff) reported as captured on an attempt; falls back to the requested amount. */
export function capturedOf(row: Pick<PaymentAttemptRow, 'rawStatus' | 'amountPaise'>): number {
  const amount = (row.rawStatus as { amount?: unknown } | null)?.amount;
  return typeof amount === 'number' && Number.isInteger(amount) ? amount : row.amountPaise;
}

async function raise(a: PaymentsAlert): Promise<void> {
  const send = alertPort();
  try {
    if (send) await send(a);
    else await captureError(new Error(`${a.title}: ${a.body}`), { route: 'payments', level: 'error' });
  } catch (err) {
    await captureError(err, { route: 'payments' });
  }
}

const ANOMALY_TEXT: Record<Anomaly, string> = {
  late_completed: 'Payment captured after the attempt had failed or expired, or after the order stopped awaiting payment',
  amount_mismatch: 'Captured amount differs from the amount requested',
};

// ---- checkout options --------------------------------------------------------------------------------------------

export interface PaymentOption {
  id: CheckoutPaymentOption;
  /** Charged now (online); 0 for offline options. */
  payNowPaise: Paise;
  /** Stock hold for this option (the reservation TTL checkout passes to inventory, A27). */
  windowSec: number;
}

export const paymentOptionsInput = z.object({ totalPaise: z.number().int().min(0), pickup: z.boolean().default(false) });

/** What checkout may offer for an order of this size, per settings. */
export async function paymentOptions(input: z.input<typeof paymentOptionsInput>): Promise<PaymentOption[]> {
  const { totalPaise, pickup } = paymentOptionsInput.parse(input);
  const s = await loadSettings();
  const online = s.attemptExpiryMinutes * 60;
  const out: PaymentOption[] = [];
  if (totalPaise >= MIN_ONLINE_PAISE) out.push({ id: 'online', payNowPaise: totalPaise as Paise, windowSec: online });
  if (s.codMode === 'partial_advance' && totalPaise >= MIN_ONLINE_PAISE * 2) out.push({ id: 'cod_partial', payNowPaise: advancePaise(totalPaise as Paise, s.advancePercent), windowSec: online });
  if (s.bankTransfer) out.push({ id: 'bank_transfer', payNowPaise: 0 as Paise, windowSec: s.bankTransferHours * 3600 });
  if (s.payAtPickup && pickup) out.push({ id: 'pay_at_pickup', payNowPaise: 0 as Paise, windowSec: online });
  return out;
}

// ---- create ------------------------------------------------------------------------------------------------------

export const createPaymentInput = z.object({ orderId: z.uuid(), method: z.enum(['online', 'cod_partial', 'bank_transfer']).default('online') });

export type CreatePaymentOutcome =
  | { ok: true; attemptId: string; merchantOrderId: string; redirectUrl: string | null; state: PaymentState; amountPaise: Paise; expiresAt: Date; instructions: string | null; reused: boolean }
  | { ok: false; reason: 'not_found' | 'not_payable' | 'method_unavailable' | 'attempt_open' | 'window_closed' | 'amount_too_small' | 'gateway_error' };

function methodAllowed(method: PaymentMethod, s: PaymentsSettings): boolean {
  if (method === 'cod_partial') return s.codMode === 'partial_advance';
  if (method === 'bank_transfer') return s.bankTransfer;
  return true;
}

/**
 * Starts (or resumes) payment for an order awaiting payment. One open attempt per order: a second call while it
 * is open returns the same redirect. Retries after a failure get the next attempt number but stay inside the
 * first attempt's window, so stock holds and payment attempts share one clock (A27).
 */
export async function createPayment(input: z.input<typeof createPaymentInput>, options: { now?: Date } = {}): Promise<CreatePaymentOutcome> {
  const { orderId, method } = createPaymentInput.parse(input);
  const now = options.now ?? new Date();
  const s = await loadSettings();
  if (!methodAllowed(method, s)) return { ok: false, reason: 'method_unavailable' };
  const orders = ordersPort();

  const created = await withTx(async (tx): Promise<CreatePaymentOutcome | PaymentAttemptRow> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payments:${orderId}`}, 0))`);
    const order = await orders.get(orderId, { tx });
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status !== 'pending_payment') return { ok: false, reason: 'not_payable' };
    const attempts = await tx.select().from(paymentsAttempt).where(eq(paymentsAttempt.orderId, orderId)).orderBy(asc(paymentsAttempt.attemptNo));
    if (attempts.some((a) => a.appliedAt)) return { ok: false, reason: 'not_payable' };

    const open = attempts.find((a) => a.state === 'pending' && a.expiresAt > now);
    if (open) {
      if (open.method !== method) return { ok: false, reason: 'attempt_open' };
      return {
        ok: true,
        attemptId: open.id,
        merchantOrderId: open.merchantOrderId,
        redirectUrl: open.redirectUrl,
        state: open.state,
        amountPaise: open.amountPaise as Paise,
        expiresAt: open.expiresAt,
        instructions: method === 'bank_transfer' ? s.bankTransferNote || null : null,
        reused: true,
      };
    }

    const windowMs = method === 'bank_transfer' ? s.bankTransferHours * 3_600_000 : s.attemptExpiryMinutes * 60_000;
    const expiresAt = attempts[0] ? attempts[0].expiresAt : new Date(now.getTime() + windowMs);
    if (expiresAt.getTime() - now.getTime() < (method === 'bank_transfer' ? 1 : MIN_WINDOW_LEFT_MS)) return { ok: false, reason: 'window_closed' };

    const due = order.totalPaise - order.paidPaise;
    const amount = method === 'cod_partial' ? (order.paidPaise > 0 ? 0 : advancePaise(order.totalPaise, s.advancePercent)) : due;
    if (amount < (method === 'bank_transfer' ? 1 : MIN_ONLINE_PAISE)) return { ok: false, reason: 'amount_too_small' };

    const attemptNo = attempts.length + 1;
    const [row] = await tx
      .insert(paymentsAttempt)
      .values({
        orderId,
        attemptNo,
        provider: method === 'bank_transfer' ? 'bank_transfer' : s.mode === 'mock' ? 'mock' : 'phonepe',
        method,
        merchantOrderId: merchantOrderId(order.number, attemptNo),
        amountPaise: amount,
        expiresAt,
        nextPollAt: method === 'bank_transfer' ? null : new Date(now.getTime() + FIRST_POLL_MS),
        isTest: order.isTest,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row!;
  });
  if ('ok' in created) return created;

  const row = created;
  const base = { attemptId: row.id, merchantOrderId: row.merchantOrderId, amountPaise: row.amountPaise as Paise, expiresAt: row.expiresAt, reused: false };
  const provider = providerFor(row.provider, s);
  if (!provider) return { ok: true, ...base, redirectUrl: null, state: 'pending', instructions: s.bankTransferNote || null };

  const order = await orders.get(row.orderId, {});
  const result = await integrationCall(
    provider.id,
    'pay',
    () =>
      provider.createPayment({
        orderId: row.orderId,
        orderNumber: order?.number ?? row.merchantOrderId,
        attemptId: row.merchantOrderId,
        amountPaise: row.amountPaise as Paise,
        customer: order?.contact ?? { name: null, phone: null, email: null },
        returnUrl: `${publicOrigin()}/pay/return?a=${row.id}`,
        expiresAt: row.expiresAt,
      }),
    { ref: row.merchantOrderId },
  );
  if (result.status !== 'ok') {
    const error = result.status === 'failed' ? result.error.message : 'gateway not configured';
    await db.update(paymentsAttempt).set({ state: 'failed', error: error.slice(0, 500), nextPollAt: null, updatedAt: new Date() }).where(eq(paymentsAttempt.id, row.id));
    return { ok: false, reason: 'gateway_error' };
  }
  const r = result.value;
  await db
    .update(paymentsAttempt)
    .set({ providerOrderId: r.providerRef, redirectUrl: r.redirectUrl, rawCreate: r as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(paymentsAttempt.id, row.id));
  return { ok: true, ...base, redirectUrl: r.redirectUrl, state: r.state, instructions: null };
}

// ---- apply -------------------------------------------------------------------------------------------------------

export interface ReportedState {
  state: PaymentState;
  amountPaise: number | null;
  raw?: unknown;
}

export interface ApplyResult {
  attempt: PaymentAttemptRow;
  decision: Decision;
}

/**
 * The one place an attempt changes state. Idempotent: the row is locked, the decision is made against its
 * current state, and replays of the same report are no-ops. A capture the order cannot take is recorded with an
 * anomaly, a refund task and a critical alert; the order itself is never flipped.
 */
export async function applyPaymentState(attemptId: string, reported: ReportedState, options: { now?: Date; actorId?: string | null } = {}): Promise<ApplyResult | null> {
  const now = options.now ?? new Date();
  const orders = ordersPort();
  const result = await withTx(async (tx) => {
    const [row] = await tx.select().from(paymentsAttempt).where(eq(paymentsAttempt.id, attemptId)).for('update');
    if (!row) return null;
    const order = await orders.get(row.orderId, { tx });
    let decision = decide({
      attempt: { state: row.state, amountPaise: row.amountPaise },
      orderStatus: order?.status ?? 'missing',
      orderDuePaise: order ? order.totalPaise - order.paidPaise : 0,
      reported: { state: reported.state, amountPaise: reported.amountPaise },
    });
    const patch: Partial<typeof paymentsAttempt.$inferInsert> = { updatedAt: now };
    // The captured amount (rawStatus.amount) caps refunds, so it is frozen once the attempt leaves pending.
    if (reported.raw !== undefined && (row.state === 'pending' || decision.next)) patch.rawStatus = reported.raw as Record<string, unknown>;
    if (decision.next) {
      patch.state = decision.next;
      patch.nextPollAt = null;
    }
    if (decision.apply) {
      const res = await orders.markPaid({ orderId: row.orderId, amountPaise: row.amountPaise as Paise, attemptId: row.id, method: row.method }, { tx });
      if (res && !res.applied) decision = { next: 'completed', apply: false, anomaly: 'late_completed' };
      else {
        patch.appliedAt = now;
        // The order is paid: no attempt of it needs the sweep any more.
        await tx.update(paymentsAttempt).set({ sweptAt: now }).where(and(eq(paymentsAttempt.orderId, row.orderId), sql`${paymentsAttempt.sweptAt} is null`));
      }
    }
    if (decision.anomaly) {
      patch.anomaly = decision.anomaly;
      await insertRefund(tx, row, { amountPaise: reported.amountPaise || row.amountPaise, state: 'task', reason: decision.anomaly, actorId: null, now });
    }
    if (options.actorId) {
      await audit({ actorId: options.actorId, actorType: 'staff', action: 'payment.mark_received', entity: 'payments_attempt', entityId: row.id, before: { state: row.state }, after: { state: patch.state ?? row.state, amountPaise: reported.amountPaise } }, { tx });
    }
    const [updated] = await tx.update(paymentsAttempt).set(patch).where(eq(paymentsAttempt.id, row.id)).returning();
    return { attempt: updated!, decision, orderNumber: order?.number ?? null };
  });
  if (!result) return null;
  if (result.decision.anomaly) {
    const a = result.attempt;
    await raise({
      rule: `payments.${result.decision.anomaly}`,
      fingerprint: a.merchantOrderId,
      severity: 'critical',
      title: `Payment needs a refund decision (${a.merchantOrderId})`,
      body: `${ANOMALY_TEXT[result.decision.anomaly]}. Order ${result.orderNumber ?? a.orderId} was not changed; a refund task is waiting on the payments page.`,
    });
  }
  return { attempt: result.attempt, decision: result.decision };
}

export type SyncOutcome = { ok: true; attempt: PaymentAttemptRow } | { ok: false; reason: 'not_found' | 'rate_limited' | 'gateway_error' };

/** Asks the gateway for the attempt's state and applies it. Offline and settled attempts are returned as they are. */
export async function syncAttempt(attemptId: string, options: { now?: Date } = {}): Promise<SyncOutcome> {
  const [row] = await db.select().from(paymentsAttempt).where(eq(paymentsAttempt.id, attemptId));
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.state === 'completed') return { ok: true, attempt: row };
  const provider = providerFor(row.provider, await loadSettings());
  if (!provider) return { ok: true, attempt: row };
  const status = await integrationCall(provider.id, 'status', () => provider.fetchStatus(row.merchantOrderId), { ref: row.merchantOrderId });
  if (status.status !== 'ok') {
    const limited = status.status === 'failed' && status.error instanceof GatewayError && status.error.status === 429;
    return { ok: false, reason: limited ? 'rate_limited' : 'gateway_error' };
  }
  const applied = await applyPaymentState(row.id, { state: status.value.state, amountPaise: status.value.amountPaise, raw: status.value.raw }, options);
  return applied ? { ok: true, attempt: applied.attempt } : { ok: false, reason: 'not_found' };
}

/** Public API name from the plan: fetch the gateway status of an attempt and apply it. */
export const fetchStatus = syncAttempt;

// ---- offline payments ----------------------------------------------------------------------------------------------

export const markReceivedInput = z.object({ attemptId: z.uuid(), amountPaise: z.number().int().positive(), actorId: z.uuid() });

/** Staff confirm a bank transfer arrived. The amount entered is checked like a gateway capture. */
export async function markBankTransferReceived(input: z.input<typeof markReceivedInput>): Promise<{ ok: true; attempt: PaymentAttemptRow; anomaly: Anomaly | null } | { ok: false; reason: 'not_found' | 'not_offline' | 'not_pending' }> {
  const { attemptId, amountPaise, actorId } = markReceivedInput.parse(input);
  const [row] = await db.select().from(paymentsAttempt).where(eq(paymentsAttempt.id, attemptId));
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.provider !== 'bank_transfer') return { ok: false, reason: 'not_offline' };
  // Only a pending transfer can be marked received; re-marking a completed one must not change its captured amount.
  if (row.state !== 'pending') return { ok: false, reason: 'not_pending' };
  const applied = await applyPaymentState(attemptId, { state: 'completed', amountPaise, raw: { amount: amountPaise, markedBy: actorId } }, { actorId });
  return applied ? { ok: true, attempt: applied.attempt, anomaly: applied.decision.anomaly } : { ok: false, reason: 'not_found' };
}

// ---- refunds -----------------------------------------------------------------------------------------------------

async function insertRefund(
  tx: Tx,
  attempt: PaymentAttemptRow,
  r: { amountPaise: number; state: PaymentRefundRow['state']; reason: string | null; actorId: string | null; now: Date },
): Promise<PaymentRefundRow> {
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(paymentsRefund).where(eq(paymentsRefund.attemptId, attempt.id))) as [{ n: number }];
  const [row] = await tx
    .insert(paymentsRefund)
    .values({
      orderId: attempt.orderId,
      attemptId: attempt.id,
      merchantRefundId: merchantRefundId(attempt.merchantOrderId, n + 1),
      amountPaise: r.amountPaise,
      state: r.state,
      reason: r.reason,
      actorId: r.actorId,
      createdAt: r.now,
      updatedAt: r.now,
    })
    .returning();
  return row!;
}

export const refundInput = z.object({
  orderId: z.uuid(),
  amountPaise: z.number().int().min(MIN_ONLINE_PAISE),
  reason: z.string().trim().min(1).max(500),
  actorId: z.uuid(),
});

export type RefundOutcome = { ok: true; refund: PaymentRefundRow } | { ok: false; reason: 'not_found' | 'exceeds_captured' | 'not_refundable' | 'gateway_error' };

/** Refunds part or all of an order's applied payment (staff action from the orders admin). */
export async function refund(input: z.input<typeof refundInput>, options: { now?: Date } = {}): Promise<RefundOutcome> {
  const { orderId, amountPaise, reason, actorId } = refundInput.parse(input);
  const now = options.now ?? new Date();
  const created = await withTx(async (tx) => {
    const attempts = await tx
      .select()
      .from(paymentsAttempt)
      .where(and(eq(paymentsAttempt.orderId, orderId), eq(paymentsAttempt.state, 'completed'), sql`${paymentsAttempt.appliedAt} is not null`))
      .orderBy(asc(paymentsAttempt.attemptNo))
      .for('update');
    if (!attempts.length) return 'not_found' as const;
    for (const a of attempts.reverse()) {
      const refunds = await tx.select().from(paymentsRefund).where(eq(paymentsRefund.attemptId, a.id));
      if (refundable(capturedOf(a), refunds) < amountPaise) continue;
      const row = await insertRefund(tx, a, { amountPaise, state: 'pending', reason, actorId, now });
      await audit({ actorId, actorType: 'staff', action: 'order.refund', entity: 'orders_order', entityId: orderId, after: { refundId: row.id, amountPaise, reason } }, { tx });
      return row;
    }
    return 'exceeds_captured' as const;
  });
  if (typeof created === 'string') return { ok: false, reason: created };
  return executeRefund(created);
}

/** Starts a refund task (late or mismatched capture) from the payments admin. */
export async function startRefundTask(input: { refundId: string; actorId: string }): Promise<RefundOutcome> {
  const { refundId, actorId } = z.object({ refundId: z.uuid(), actorId: z.uuid() }).parse(input);
  const started = await withTx(async (tx) => {
    const [row] = await tx
      .update(paymentsRefund)
      .set({ state: 'pending', actorId, updatedAt: new Date() })
      .where(and(eq(paymentsRefund.id, refundId), eq(paymentsRefund.state, 'task')))
      .returning();
    if (row) await audit({ actorId, actorType: 'staff', action: 'payment.refund_task_start', entity: 'payments_refund', entityId: row.id, after: { amountPaise: row.amountPaise } }, { tx });
    return row ?? null;
  });
  return started ? executeRefund(started) : { ok: false, reason: 'not_refundable' };
}

async function executeRefund(row: PaymentRefundRow): Promise<RefundOutcome> {
  const [attempt] = await db.select().from(paymentsAttempt).where(eq(paymentsAttempt.id, row.attemptId));
  const provider = attempt ? providerFor(attempt.provider, await loadSettings()) : null;
  if (!attempt) return { ok: false, reason: 'not_found' };
  if (!provider) {
    // Offline money goes back offline: staff have sent it; record it as done.
    const settled = await applyRefundState(row.id, 'completed', { offline: true });
    return { ok: true, refund: settled ?? row };
  }
  const result = await integrationCall(
    provider.id,
    'refund',
    () => provider.refund!({ providerRef: attempt.merchantOrderId, refundId: row.merchantRefundId, amountPaise: row.amountPaise as Paise, reason: row.reason }),
    { ref: row.merchantRefundId },
  );
  if (result.status !== 'ok') {
    const settled = await applyRefundState(row.id, 'failed', { error: result.status === 'failed' ? result.error.message : 'not configured' });
    return settled ? { ok: false, reason: 'gateway_error' } : { ok: false, reason: 'not_found' };
  }
  await db
    .update(paymentsRefund)
    .set({ providerRefundId: result.value.providerRefundRef, nextPollAt: new Date(Date.now() + 30_000), updatedAt: new Date() })
    .where(eq(paymentsRefund.id, row.id));
  const settled = result.value.state === 'pending' ? null : await applyRefundState(row.id, result.value.state, result.value);
  const [fresh] = await db.select().from(paymentsRefund).where(eq(paymentsRefund.id, row.id));
  return { ok: true, refund: settled ?? fresh! };
}

/** Settles a refund once (pending -> completed | failed). A completed refund of an applied payment updates the order. */
export async function applyRefundState(refundId: string, state: 'pending' | 'completed' | 'failed', raw: unknown): Promise<PaymentRefundRow | null> {
  return withTx(async (tx) => {
    const [row] = await tx.select().from(paymentsRefund).where(eq(paymentsRefund.id, refundId)).for('update');
    if (!row) return null;
    if (row.state !== 'pending' || state === 'pending') return row;
    const [updated] = await tx.update(paymentsRefund).set({ state, raw: raw as Record<string, unknown>, nextPollAt: null, updatedAt: new Date() }).where(eq(paymentsRefund.id, row.id)).returning();
    if (state === 'completed') {
      const [attempt] = await tx.select().from(paymentsAttempt).where(eq(paymentsAttempt.id, row.attemptId));
      if (attempt?.appliedAt) await ordersPort().markRefunded({ orderId: row.orderId, refundId: row.id, amountPaise: row.amountPaise as Paise }, { tx });
    }
    return updated!;
  });
}

export async function syncRefund(refundId: string): Promise<{ ok: true; refund: PaymentRefundRow } | { ok: false; reason: 'not_found' | 'rate_limited' | 'gateway_error' }> {
  const [row] = await db.select().from(paymentsRefund).where(eq(paymentsRefund.id, refundId));
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.state !== 'pending') return { ok: true, refund: row };
  const [attempt] = await db.select().from(paymentsAttempt).where(eq(paymentsAttempt.id, row.attemptId));
  const provider = attempt ? providerFor(attempt.provider, await loadSettings()) : null;
  if (!provider) return { ok: true, refund: row };
  const status = await integrationCall(provider.id, 'refund-status', () => provider.refundStatus(row.merchantRefundId), { ref: row.merchantRefundId });
  if (status.status !== 'ok') {
    const limited = status.status === 'failed' && status.error instanceof GatewayError && status.error.status === 429;
    return { ok: false, reason: limited ? 'rate_limited' : 'gateway_error' };
  }
  const settled = await applyRefundState(row.id, status.value.state, status.value.raw);
  return settled ? { ok: true, refund: settled } : { ok: false, reason: 'not_found' };
}
