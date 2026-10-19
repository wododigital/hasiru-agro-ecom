import { NotFoundError } from '@ecomkit/core/auth-context';
import { db, withTx } from '@ecomkit/core/db';
import { and, count, desc, eq, ne } from 'drizzle-orm';
import { addressInputSchema } from '../domain';
import { customersAddress } from '../schema';
import { currentCustomer, idOr404 } from './viewer';

export type AddressRow = typeof customersAddress.$inferSelect;

const MAX_ADDRESSES = 20;

/** The signed-in customer's addresses, default first. */
export async function listMyAddresses(): Promise<AddressRow[]> {
  const me = await currentCustomer();
  return db
    .select()
    .from(customersAddress)
    .where(eq(customersAddress.userId, me.customerId))
    .orderBy(desc(customersAddress.isDefault), desc(customersAddress.createdAt), desc(customersAddress.id));
}

/**
 * Creates or updates one of the viewer's addresses. Every read and write is scoped to the viewer's id,
 * so an id that belongs to someone else behaves exactly like one that does not exist (404).
 * The first address becomes the default; making one default clears the others in the same transaction.
 */
export async function saveMyAddress(raw: unknown): Promise<AddressRow> {
  const me = await currentCustomer();
  const { id, ...input } = addressInputSchema.parse(raw);
  return withTx(async (tx) => {
    const mine = eq(customersAddress.userId, me.customerId);
    let isDefault = input.isDefault;
    if (id) {
      const [existing] = await tx.select({ isDefault: customersAddress.isDefault }).from(customersAddress).where(and(eq(customersAddress.id, id), mine));
      if (!existing) throw new NotFoundError();
      // A default stays default until another address takes over.
      isDefault ||= existing.isDefault;
    } else {
      const [{ n }] = (await tx.select({ n: count() }).from(customersAddress).where(mine)) as [{ n: number }];
      if (n >= MAX_ADDRESSES) throw new Error('address_limit');
      isDefault ||= n === 0;
    }
    if (isDefault) {
      await tx
        .update(customersAddress)
        .set({ isDefault: false })
        .where(and(mine, id ? ne(customersAddress.id, id) : undefined));
    }
    if (id) {
      const [row] = await tx
        .update(customersAddress)
        .set({ ...input, isDefault })
        .where(and(eq(customersAddress.id, id), mine))
        .returning();
      return row!;
    }
    const [row] = await tx.insert(customersAddress).values({ ...input, isDefault, userId: me.customerId }).returning();
    return row!;
  });
}

export async function deleteMyAddress(rawId: string): Promise<void> {
  const me = await currentCustomer();
  const id = idOr404(rawId);
  await withTx(async (tx) => {
    const [gone] = await tx
      .delete(customersAddress)
      .where(and(eq(customersAddress.id, id), eq(customersAddress.userId, me.customerId)))
      .returning({ isDefault: customersAddress.isDefault });
    if (!gone) throw new NotFoundError();
    if (gone.isDefault) {
      const [next] = await tx
        .select({ id: customersAddress.id })
        .from(customersAddress)
        .where(eq(customersAddress.userId, me.customerId))
        .orderBy(desc(customersAddress.createdAt), desc(customersAddress.id))
        .limit(1);
      if (next) await tx.update(customersAddress).set({ isDefault: true }).where(eq(customersAddress.id, next.id));
    }
  });
}
