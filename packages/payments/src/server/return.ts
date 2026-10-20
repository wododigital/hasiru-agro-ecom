// /pay/return: where the gateway sends the buyer back. The query carries only our attempt id (a random UUID);
// the state shown comes from the gateway status API, never from query parameters.
import type { Paise } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { paymentsAttempt } from '../schema';
import { syncAttempt } from './payments';
import { ordersPort } from './ports';

export type ReturnState = 'paid' | 'pending' | 'failed' | 'review';

export interface ReturnView {
  state: ReturnState;
  amountPaise: Paise;
  orderLink: string | null;
  /** Where to try again; null once the payment window is over. */
  retryLink: string | null;
}

const RETRY_MIN_LEFT_MS = 5 * 60_000;

export async function returnView(attemptIdInput: unknown, options: { now?: Date } = {}): Promise<ReturnView | null> {
  const id = z.uuid().safeParse(attemptIdInput);
  if (!id.success) return null;
  let [row] = await db.select().from(paymentsAttempt).where(eq(paymentsAttempt.id, id.data));
  if (!row) return null;
  // Each visit (the pending view refreshes itself) asks the gateway, capped per attempt.
  if (row.state === 'pending' && (await rateLimit(`pay-return:${row.id}`, { limit: 30, windowSec: 600 })).ok) {
    const synced = await syncAttempt(row.id, options);
    if (synced.ok) row = synced.attempt;
  }
  const now = options.now ?? new Date();
  const orders = ordersPort();
  const state: ReturnState = row.state === 'completed' ? (row.appliedAt ? 'paid' : 'review') : row.state === 'pending' ? 'pending' : 'failed';
  const canRetry = state === 'failed' && row.expiresAt.getTime() - now.getTime() >= RETRY_MIN_LEFT_MS;
  return {
    state,
    amountPaise: row.amountPaise as Paise,
    orderLink: await orders.orderLink(row.orderId),
    retryLink: canRetry ? (orders.payLink?.(row.orderId) ?? `/checkout/${row.orderId}/pay`) : null,
  };
}
