// Status callbacks from the ERP (packed / dispatched / delivered). The adapter's route verifies the signature and
// timestamp; this records the nonce once (replay protection) and hands the status to the orders port.
import { db } from '@ecomkit/core/db';
import { eq } from 'drizzle-orm';
import { statusCallbackSchema } from '../domain';
import { erpWebhookEvent } from '../schema';
import { getPorts } from './ports';

export type StatusCallbackResult = { ok: true; outcome: 'applied' | 'no_handler' | 'unknown_order' | 'duplicate' } | { ok: false; error: 'invalid_body' };

export async function acceptStatusCallback(nonce: string, body: unknown): Promise<StatusCallbackResult> {
  const parsed = statusCallbackSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'invalid_body' };
  const inserted = await db
    .insert(erpWebhookEvent)
    .values({ nonce, ecomOrderNumber: parsed.data.ecomOrderNumber, status: parsed.data.status, outcome: 'received' })
    .onConflictDoNothing()
    .returning({ nonce: erpWebhookEvent.nonce });
  if (!inserted.length) return { ok: true, outcome: 'duplicate' };
  const apply = getPorts().applyOrderStatus;
  const outcome = !apply ? 'no_handler' : (await apply(parsed.data)) ? 'applied' : 'unknown_order';
  await db.update(erpWebhookEvent).set({ outcome }).where(eq(erpWebhookEvent.nonce, nonce));
  return { ok: true, outcome };
}
