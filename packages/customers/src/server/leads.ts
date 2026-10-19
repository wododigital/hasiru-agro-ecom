import { audit } from '@ecomkit/core/audit';
import { getViewer, NotFoundError, requirePermission } from '@ecomkit/core/auth-context';
import { db, withTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { LEAD_STATUSES, leadInputSchema, maskEmail, maskPhone, maskPii, seesFullPii, type LeadInput, type LeadSource, type LeadStatus } from '../domain';
import { customersLead } from '../schema';
import { hashContact } from './hash';
import { idOr404 } from './viewer';

export type LeadRow = typeof customersLead.$inferSelect;

/**
 * The one way to create a lead. A repeat from the same phone and source with the same `context.ref`
 * while the lead is still open updates that lead (name, context, verified flag) instead of adding a row.
 * `lead.created` (the only event that pushes leads to the ERP) is emitted once, when a row is inserted,
 * in the caller's transaction.
 */
export async function upsertLead(raw: LeadInput, options: { tx?: Tx } = {}): Promise<{ leadId: string; created: boolean; phoneHash: string }> {
  const input = leadInputSchema.parse(raw);
  const phoneHash = hashContact(input.phone)!;
  const ref = typeof input.context.ref === 'string' ? input.context.ref : null;
  const run = async (tx: Tx) => {
    // Serialise concurrent submits from one phone so the dedupe check cannot race.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`customers-lead:${phoneHash}`}))`);
    if (ref) {
      const [open] = await tx
        .select({ id: customersLead.id, phoneVerified: customersLead.phoneVerified, context: customersLead.context })
        .from(customersLead)
        .where(
          and(
            eq(customersLead.phoneHash, phoneHash),
            eq(customersLead.source, input.source),
            inArray(customersLead.status, ['new', 'contacted']),
            sql`${customersLead.context}->>'ref' = ${ref}`,
          ),
        )
        .limit(1);
      if (open) {
        await tx
          .update(customersLead)
          .set({
            name: input.name,
            context: { ...open.context, ...input.context },
            phoneVerified: open.phoneVerified || input.phoneVerified,
            userId: input.userId ?? undefined,
          })
          .where(eq(customersLead.id, open.id));
        return { leadId: open.id, created: false, phoneHash };
      }
    }
    const [row] = await tx
      .insert(customersLead)
      .values({
        name: input.name,
        phoneE164: input.phone,
        phoneHash,
        phoneVerified: input.phoneVerified,
        source: input.source,
        context: input.context,
        userId: input.userId ?? null,
      })
      .returning({ id: customersLead.id });
    await emit('lead.created', { leadId: row!.id, source: input.source }, { tx });
    return { leadId: row!.id, created: true, phoneHash };
  };
  return options.tx ? run(options.tx) : withTx(run);
}

/**
 * What other modules (enquiries, planting, chat) get when the host wires customers in, so they create
 * leads and hash or mask contacts without importing this module directly.
 */
export interface ContactPort {
  upsertLead: typeof upsertLead;
  hashContact: typeof hashContact;
  maskPhone: typeof maskPhone;
  maskEmail: typeof maskEmail;
  seesFullPii: typeof seesFullPii;
}
export const contactPort: ContactPort = { upsertLead, hashContact, maskPhone, maskEmail, seesFullPii };

export async function listLeads(
  options: { status?: LeadStatus; source?: LeadSource; page?: number; pageSize?: number } = {},
): Promise<{ rows: LeadRow[]; total: number }> {
  await requirePermission('customers.read');
  const viewer = await getViewer();
  const pageSize = options.pageSize ?? 25;
  const where = and(options.status ? eq(customersLead.status, options.status) : undefined, options.source ? eq(customersLead.source, options.source) : undefined);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(customersLead)
      .where(where)
      .orderBy(desc(customersLead.createdAt), desc(customersLead.id))
      .limit(pageSize)
      .offset(((options.page ?? 1) - 1) * pageSize),
    db.select({ n: count() }).from(customersLead).where(where),
  ]);
  return { rows: rows.map((r) => maskPii(r, viewer)), total: total!.n };
}

export async function setLeadStatus(rawId: string, status: LeadStatus): Promise<void> {
  const staff = await requirePermission('customers.write');
  const id = idOr404(rawId);
  if (!LEAD_STATUSES.includes(status)) throw new Error('invalid_status');
  await withTx(async (tx) => {
    const [before] = await tx.select({ status: customersLead.status }).from(customersLead).where(eq(customersLead.id, id)).for('update');
    if (!before) throw new NotFoundError();
    await tx.update(customersLead).set({ status }).where(eq(customersLead.id, id));
    await audit({ actorId: staff.userId, actorType: 'staff', action: 'lead.status', entity: 'lead', entityId: id, before, after: { status } }, { tx });
  });
}
