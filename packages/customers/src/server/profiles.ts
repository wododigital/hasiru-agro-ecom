import { audit } from '@ecomkit/core/audit';
import { getViewer, NotFoundError, requirePermission } from '@ecomkit/core/auth-context';
import { db, withTx, type DbOrTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { normalisePhone } from '@ecomkit/core/ids';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { maskPii, profileInputSchema, type CustomerType, type ProfileInput } from '../domain';
import { customersAddress, customersConsent, customersLandProfile, customersLead, customersProfile } from '../schema';
import { hashContact } from './hash';
import { currentCustomer } from './viewer';

export type CustomerRow = typeof customersProfile.$inferSelect;

/**
 * Creates the profile for a new auth user (idempotent) and emits `customer.created` the first time.
 * Called by the auth module on sign-up and by checkout for guests who create an account.
 */
export async function ensureProfile(
  input: { userId: string; name?: string | null; phone?: string | null; email?: string | null; customerType?: CustomerType; source?: string | null },
  options: { tx?: Tx } = {},
): Promise<{ created: boolean }> {
  const run = async (tx: Tx) => {
    const phone = input.phone ? normalisePhone(input.phone) : null;
    const email = input.email?.trim().toLowerCase() || null;
    const inserted = await tx
      .insert(customersProfile)
      .values({
        userId: input.userId,
        displayName: input.name?.trim() || null,
        phoneE164: phone,
        phoneHash: hashContact(phone),
        email,
        emailHash: hashContact(email),
        customerType: input.customerType ?? 'individual',
        source: input.source ?? null,
      })
      .onConflictDoNothing()
      .returning({ userId: customersProfile.userId });
    if (inserted.length) await emit('customer.created', { customerId: input.userId }, { tx });
    return { created: inserted.length > 0 };
  };
  return options.tx ? run(options.tx) : withTx(run);
}

export async function getMyProfile(): Promise<CustomerRow | null> {
  const me = await currentCustomer();
  const [row] = await db.select().from(customersProfile).where(eq(customersProfile.userId, me.customerId));
  return row ?? null;
}

export async function updateMyProfile(raw: unknown): Promise<CustomerRow> {
  const me = await currentCustomer();
  const input: ProfileInput = profileInputSchema.parse(raw);
  return withTx(async (tx) => {
    // A signed-in customer always has a profile; create it here if the auth hook has not yet.
    await ensureProfile({ userId: me.customerId, name: me.name, phone: me.phone, email: me.email, source: 'account' }, { tx });
    const [before] = await tx.select().from(customersProfile).where(eq(customersProfile.userId, me.customerId)).for('update');
    if (!before) throw new NotFoundError();
    const [after] = await tx
      .update(customersProfile)
      .set({ ...input, emailHash: hashContact(input.email) })
      .where(eq(customersProfile.userId, me.customerId))
      .returning();
    await audit(
      { actorId: me.userId, actorType: 'customer', action: 'customer.update', entity: 'customer', entityId: me.customerId, before: pick(before), after: pick(after!) },
      { tx },
    );
    return after!;
  });
}

const pick = (r: CustomerRow) => ({ displayName: r.displayName, email: r.email, customerType: r.customerType, gstin: r.gstin, legalName: r.legalName });

/** Admin: one customer, personal data masked for roles that may not see it. */
export async function getCustomer(userId: string): Promise<CustomerRow | null> {
  await requirePermission('customers.read');
  const viewer = await getViewer();
  const [row] = await db.select().from(customersProfile).where(eq(customersProfile.userId, userId));
  return row ? maskPii(row, viewer) : null;
}

/** Admin list. `q` matches a phone or email exactly (by hash) or a name by substring. */
export async function listCustomers(options: { q?: string; page?: number; pageSize?: number } = {}): Promise<{ rows: CustomerRow[]; total: number }> {
  await requirePermission('customers.read');
  const viewer = await getViewer();
  const pageSize = options.pageSize ?? 25;
  const q = options.q?.trim();
  const where = q
    ? or(eq(customersProfile.phoneHash, hashContact(q) ?? ''), eq(customersProfile.emailHash, hashContact(q) ?? ''), ilike(customersProfile.displayName, `%${q.replace(/[%_\\]/g, '\\$&')}%`))
    : undefined;
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(customersProfile)
      .where(where)
      .orderBy(desc(customersProfile.createdAt), desc(customersProfile.userId))
      .limit(pageSize)
      .offset(((options.page ?? 1) - 1) * pageSize),
    db.select({ n: count() }).from(customersProfile).where(where),
  ]);
  return { rows: rows.map((r) => maskPii(r, viewer)), total: total!.n };
}

/** Orders module hook: keeps the order counters the segments read. Call inside the order transaction. */
export async function recordOrder(input: { userId: string; amountPaise: number; at: Date }, options: { tx?: DbOrTx } = {}): Promise<void> {
  const at = input.at.toISOString();
  await (options.tx ?? db)
    .update(customersProfile)
    .set({
      ordersCount: sql`${customersProfile.ordersCount} + 1`,
      lifetimePaise: sql`${customersProfile.lifetimePaise} + ${input.amountPaise}`,
      firstOrderAt: sql`coalesce(${customersProfile.firstOrderAt}, ${at}::timestamptz)`,
      lastOrderAt: sql`greatest(${customersProfile.lastOrderAt}, ${at}::timestamptz)`,
    })
    .where(eq(customersProfile.userId, input.userId));
}

/** DPDP export: everything this module holds about one customer. Needs customers.export (owner, manager). */
export async function exportCustomerData(userId: string) {
  const staff = await requirePermission('customers.export');
  const [profile] = await db.select().from(customersProfile).where(eq(customersProfile.userId, userId));
  if (!profile) throw new NotFoundError();
  const subject = or(eq(customersConsent.userId, userId), profile.phoneHash ? eq(customersConsent.phoneHash, profile.phoneHash) : undefined, profile.emailHash ? eq(customersConsent.emailHash, profile.emailHash) : undefined);
  const [addresses, consents, leads, land] = await Promise.all([
    db.select().from(customersAddress).where(eq(customersAddress.userId, userId)),
    db.select().from(customersConsent).where(subject).orderBy(customersConsent.createdAt),
    db.select().from(customersLead).where(or(eq(customersLead.userId, userId), profile.phoneHash ? eq(customersLead.phoneHash, profile.phoneHash) : undefined)),
    db.select().from(customersLandProfile).where(and(eq(customersLandProfile.userId, userId))),
  ]);
  await audit({ actorId: staff.userId, actorType: 'staff', action: 'customer.export', entity: 'customer', entityId: userId });
  return { profile, addresses, consents, leads, land };
}
