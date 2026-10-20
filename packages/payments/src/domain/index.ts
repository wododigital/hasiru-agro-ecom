// Pure payment rules: ids, amounts, the attempt state machine, poll cadence. No DB, no network.
import type { Paise, PaymentState } from '@ecomkit/core/contracts';

export * from './phonepe';

export type PaymentMethod = 'online' | 'cod_partial' | 'bank_transfer';
/** What checkout may offer; `pay_at_pickup` has no attempt (the order is paid at collection). */
export type CheckoutPaymentOption = PaymentMethod | 'pay_at_pickup';
export type Anomaly = 'late_completed' | 'amount_mismatch';

const MERCHANT_ID_RE = /^[A-Za-z0-9_-]{1,63}$/;

/** `<order number>-<attempt no>`: the gateway allows 63 chars of letters, digits, `_` and `-`, and refuses a reused id. */
export function merchantOrderId(orderNumber: string, attemptNo: number): string {
  const id = `${orderNumber}-${attemptNo}`;
  if (!MERCHANT_ID_RE.test(id) || !Number.isInteger(attemptNo) || attemptNo < 1) throw new RangeError(`invalid merchant order id "${id}"`);
  return id;
}

export const merchantRefundId = (merchantOrder: string, n: number): string => merchantOrderId(merchantOrder, n).replace(/-(\d+)$/, '-R$1');

/** The gateway's minimum charge is Rs 1. */
export const MIN_ONLINE_PAISE = 100;

/** Online advance in partial mode: `pct` of the total, rounded up to whole rupees, at least Rs 1, never above the total. */
export function advancePaise(totalPaise: Paise, pct: number): Paise {
  const raw = Math.ceil((totalPaise * pct) / 100 / 100) * 100;
  return Math.min(totalPaise, Math.max(MIN_ONLINE_PAISE, raw)) as Paise;
}

/** Gateway order states (`PENDING | COMPLETED | FAILED`, parsed leniently) to ours. */
export function gatewayState(state: string | null | undefined): PaymentState {
  const s = (state ?? '').toUpperCase();
  if (s === 'COMPLETED') return 'completed';
  if (s === 'FAILED') return 'failed';
  return 'pending';
}

export interface DecideInput {
  attempt: { state: PaymentState; amountPaise: number };
  /** Order status from the orders module (`pending_payment` is the only one that can take a payment). */
  orderStatus: string;
  /** What the order still owes (total minus what is already paid). */
  orderDuePaise: number;
  reported: { state: PaymentState; amountPaise: number | null };
}

export interface Decision {
  /** New attempt state, or null to leave the row alone. */
  next: PaymentState | null;
  /** Call orders.markPaid. */
  apply: boolean;
  anomaly: Anomaly | null;
}

const NOOP: Decision = { next: null, apply: false, anomaly: null };

/**
 * The one attempt state machine, shared by the return page, the webhook job, the poll and the sweep.
 * Only `pending` moves; `completed` is final. Money captured that the order cannot take (the attempt already
 * failed or expired, the order is no longer awaiting payment, or the amount differs) is recorded as completed
 * with an anomaly: the order is never flipped, staff get an alert and a refund task instead.
 */
export function decide({ attempt, orderStatus, orderDuePaise, reported }: DecideInput): Decision {
  if (attempt.state === 'completed' || reported.state === 'pending') return NOOP;
  if (reported.state !== 'completed') return attempt.state === 'pending' ? { next: reported.state, apply: false, anomaly: null } : NOOP;
  if (attempt.state !== 'pending') return { next: 'completed', apply: false, anomaly: 'late_completed' };
  if (reported.amountPaise !== attempt.amountPaise || attempt.amountPaise > orderDuePaise) return { next: 'completed', apply: false, anomaly: 'amount_mismatch' };
  if (orderStatus !== 'pending_payment') return { next: 'completed', apply: false, anomaly: 'late_completed' };
  return { next: 'completed', apply: true, anomaly: null };
}

/** Seconds until the next status poll for a pending attempt of this age (the gateway asks for early, then slower, checks). */
export function pollDelaySec(ageSec: number): number {
  if (ageSec < 60) return 20;
  if (ageSec < 300) return 30;
  return 60;
}

/** Back-off after a 429: 30 s doubling per consecutive hit, capped at 5 min. */
export const backoffSec = (hits: number): number => Math.min(300, 30 * 2 ** Math.max(0, hits - 1));

/** Webhook dedupe key: the same event about the same order or refund in the same state is processed once. */
export const webhookDedupeKey = (event: string, ref: string, state: string): string => `${event}:${ref}:${state}`.slice(0, 300);

/** A refund may not take more than was captured, counting refunds already started or done. */
export function refundable(capturedPaise: number, refunds: readonly { amountPaise: number; state: string }[]): number {
  const used = refunds.filter((r) => r.state !== 'failed').reduce((s, r) => s + r.amountPaise, 0);
  return Math.max(0, capturedPaise - used);
}
