// Back-in-stock ("notify me") subscriptions and their delivery.
import { invalidateTags, tags } from '@ecomkit/core/cache-tags';
import type { EventHandler, NotificationSender } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { newId, normalisePhone } from '@ecomkit/core/ids';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { notifyMeSchema, type NotifyMeInput } from '../domain';
import { inventoryLevel, inventorySubscription } from '../schema';
import { getStock } from './stock';

type SenderProvider = () => Promise<NotificationSender | null>;
let senderProvider: SenderProvider = async () => null;

/**
 * The app binds the notifications service once at boot, normally `() => registry.service('notifications')`
 * (same pattern as core `setAuthProvider`). Unbound or disabled: subscriptions stay pending and nothing is sent.
 */
export function setNotificationsProvider(next: SenderProvider): void {
  senderProvider = next;
}

const MAX_PENDING_PER_CONTACT = 5;

export class SubscribeError extends Error {
  constructor(readonly code: 'unknown_variant' | 'invalid_phone' | 'too_many') {
    super(code);
    this.name = 'SubscribeError';
  }
}

/** Idempotent per (variant, phone, email): subscribing again re-arms a subscription that was already notified. */
export async function subscribe(input: NotifyMeInput | Record<string, unknown>): Promise<{ subscriptionId: string }> {
  const v = notifyMeSchema.parse(input);
  const phone = v.phone ? normalisePhone(v.phone) : null;
  if (v.phone && !phone) throw new SubscribeError('invalid_phone');
  const email = v.email?.toLowerCase() ?? null;
  const [level] = await db.select({ productId: inventoryLevel.productId }).from(inventoryLevel).where(eq(inventoryLevel.variantId, v.variantId));
  if (!level) throw new SubscribeError('unknown_variant');
  // Contacts are not verified, so cap pending alerts per phone/email: limits how much a stranger can enrol someone else.
  const { rows: pending } = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from inventory_subscription
    where notified_at is null and variant_id <> ${v.variantId}
      and ((${phone}::text is not null and phone = ${phone}) or (${email}::text is not null and email = ${email}))`);
  if ((pending[0]?.n ?? 0) >= MAX_PENDING_PER_CONTACT) throw new SubscribeError('too_many');
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into inventory_subscription (id, variant_id, product_id, phone, email)
    values (${newId()}, ${v.variantId}, ${level.productId}, ${phone}, ${email})
    on conflict (variant_id, coalesce(phone, ''), coalesce(email, '')) do update set notified_at = null
    returning id`);
  return { subscriptionId: rows[0]!.id };
}

/**
 * Sends `stock.back_in_stock` to pending subscribers of a variant that has sellable stock.
 * Rows are claimed (notified_at set) before sending so two workers never double-send; a failed send un-claims its row and rethrows (job retry).
 */
export async function notifyBackInStock(variantId: string, options: { batch?: number } = {}): Promise<{ sent: number; pending: number }> {
  const stock = await getStock(variantId);
  if (!stock || stock.available <= 0) return { sent: 0, pending: 0 };
  const sender = await senderProvider();
  if (!sender) return { sent: 0, pending: await pendingCount(variantId) };

  const { rows } = await db.execute<{ id: string; product_id: string; phone: string | null; email: string | null }>(sql`
    update inventory_subscription set notified_at = now()
    where id in (
      select id from inventory_subscription
      where variant_id = ${variantId} and notified_at is null
      order by created_at limit ${options.batch ?? 200}
      for update skip locked)
    returning id, product_id, phone, email`);

  let sent = 0;
  for (const row of rows) {
    try {
      await sender.send('stock.back_in_stock', { phone: row.phone, email: row.email }, { productId: row.product_id, variantId });
      sent++;
    } catch (err) {
      const unsent = rows.slice(sent).map((r) => r.id);
      await db.update(inventorySubscription).set({ notifiedAt: null }).where(inArray(inventorySubscription.id, unsent));
      throw err;
    }
  }
  return { sent, pending: await pendingCount(variantId) };
}

async function pendingCount(variantId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inventorySubscription)
    .where(and(eq(inventorySubscription.variantId, variantId), isNull(inventorySubscription.notifiedAt)));
  return row?.n ?? 0;
}

/** Subscriber for `stock.changed` (worker): expire the storefront stock tags, then deliver back-in-stock messages. */
export const onStockChanged: EventHandler<'stock.changed'> = async (payload) => {
  await invalidateTags([tags.stock(payload.productId), tags.stock(payload.variantId)]);
  if (payload.available <= 0) return;
  for (let r = await notifyBackInStock(payload.variantId); r.sent > 0 && r.pending > 0; r = await notifyBackInStock(payload.variantId));
};
