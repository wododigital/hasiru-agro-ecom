import { NotFoundError } from '@ecomkit/core/auth-context';
import { db } from '@ecomkit/core/db';
import { and, desc, eq } from 'drizzle-orm';
import { landInputSchema } from '../domain';
import { customersLandProfile } from '../schema';
import { currentCustomer, idOr404 } from './viewer';

export type LandRow = typeof customersLandProfile.$inferSelect;

/** Saved land profiles (area, district, purpose) the planting wizard can reuse. */
export async function listMyLand(): Promise<LandRow[]> {
  const me = await currentCustomer();
  return db
    .select()
    .from(customersLandProfile)
    .where(eq(customersLandProfile.userId, me.customerId))
    .orderBy(desc(customersLandProfile.createdAt), desc(customersLandProfile.id));
}

/** Create or update; scoped to the viewer like addresses (someone else's id is a 404). */
export async function saveMyLand(raw: unknown): Promise<LandRow> {
  const me = await currentCustomer();
  const { id, ...input } = landInputSchema.parse(raw);
  if (id) {
    const [row] = await db
      .update(customersLandProfile)
      .set(input)
      .where(and(eq(customersLandProfile.id, id), eq(customersLandProfile.userId, me.customerId)))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  }
  const [row] = await db.insert(customersLandProfile).values({ ...input, userId: me.customerId }).returning();
  return row!;
}

export async function deleteMyLand(rawId: string): Promise<void> {
  const me = await currentCustomer();
  const id = idOr404(rawId);
  const gone = await db
    .delete(customersLandProfile)
    .where(and(eq(customersLandProfile.id, id), eq(customersLandProfile.userId, me.customerId)))
    .returning({ id: customersLandProfile.id });
  if (!gone.length) throw new NotFoundError();
}
