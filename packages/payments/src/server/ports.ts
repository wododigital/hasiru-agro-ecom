import type { Tx } from '@ecomkit/core/db';
import type { Paise } from '@ecomkit/core/contracts';
import type { PaymentMethod } from '../domain';

export interface PaymentOrder {
  id: string;
  number: string;
  /** Orders status enum; only `pending_payment` can take a payment. */
  status: string;
  totalPaise: Paise;
  paidPaise: Paise;
  isTest: boolean;
  contact: { name: string | null; phone: string | null; email: string | null };
}

/**
 * What payments needs from the orders module (its transition API). The host binds it at boot:
 * `configurePayments({ orders: paymentsOrdersPort })`. Every write runs inside the transaction payments
 * passes, so the attempt row and the order move together, and the orders side emits its own events
 * (`order.paid`, `order.payment_failed`, `order.refunded`) from that transaction.
 */
export interface PaymentsOrdersPort {
  get(orderId: string, options: { tx?: Tx }): Promise<PaymentOrder | null>;
  /**
   * pending_payment -> paid (or partially paid when `amountPaise` is below the total); emits `order.paid`.
   * May answer `{ applied: false }` when the order moved on under its own lock (cancelled meanwhile): payments then
   * records the capture as an anomaly (alert + refund task) instead.
   */
  markPaid(input: { orderId: string; amountPaise: Paise; attemptId: string; method: PaymentMethod }, options: { tx: Tx }): Promise<void | { applied: boolean }>;
  /**
   * The payment window closed without a payment: cancel, release stock, emit `order.payment_failed`.
   * Must be a no-op unless the order is still `pending_payment` (the sweep may call it again).
   */
  paymentExpired(input: { orderId: string; reason: 'failed' | 'expired' }, options: { tx: Tx }): Promise<void>;
  /** A refund of an applied payment settled: refunded or partially refunded; emits `order.refunded`. */
  markRefunded(input: { orderId: string; refundId: string; amountPaise: Paise }, options: { tx: Tx }): Promise<void>;
  /** The buyer's link to the order (account page, or the guest token page). */
  orderLink(orderId: string): Promise<string | null>;
  /** Where a buyer retries a failed payment. Defaults to `/checkout/<orderId>/pay`. */
  payLink?(orderId: string): string;
  /** Called by every sweep run for orders that never reached the pay step and are older than `cutoff`. */
  sweepWithoutAttempt?(cutoff: Date): Promise<number>;
}

export interface PaymentsAlert {
  /** Rule keys: `payments.late_completed`, `payments.amount_mismatch`, `payments.webhook_signature`, `payments.stuck`. */
  rule: string;
  fingerprint: string;
  title: string;
  body: string;
  severity: 'critical' | 'high' | 'low';
}

const ports: { orders: PaymentsOrdersPort | null; alert: ((a: PaymentsAlert) => Promise<unknown>) | null } = { orders: null, alert: null };

/**
 * Called once at app boot (instrumentation and worker):
 * `configurePayments({ orders: paymentsOrdersPort, alert: (a) => alert(a) })` with monitoring's `alert` when enabled.
 * Without `alert`, anomalies are still recorded (attempt `anomaly`, refund task) and go to the error log.
 */
export function configurePayments(next: Partial<typeof ports>): void {
  Object.assign(ports, next);
}

export function ordersPort(): PaymentsOrdersPort {
  if (!ports.orders) throw new Error('payments: configurePayments({ orders }) was not called at boot');
  return ports.orders;
}

export const alertPort = () => ports.alert;
