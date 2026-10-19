import { audit } from '@ecomkit/core/audit';
import { requirePermission } from '@ecomkit/core/auth-context';
import { db, withTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { and, count, desc, eq, or, type SQL } from 'drizzle-orm';
import { consentInputSchema, consentSubjectSchema, type ConsentInput, type ConsentPurpose, type ConsentSubject } from '../domain';
import { customersConsent } from '../schema';
import { hashContact } from './hash';

export type ConsentRow = typeof customersConsent.$inferSelect;

function subjectWhere(raw: ConsentSubject): SQL | undefined {
  const s = consentSubjectSchema.parse(raw);
  return or(
    s.userId ? eq(customersConsent.userId, s.userId) : undefined,
    s.phone ? eq(customersConsent.phoneHash, hashContact(s.phone)!) : undefined,
    s.email ? eq(customersConsent.emailHash, hashContact(s.email)!) : undefined,
  );
}

/**
 * Records a grant or a revocation as a new row (never an update), with the exact text shown, the source,
 * a hashed IP and the user agent; writes an audit row and emits `consent.changed`, all in one transaction.
 * The single consent store (A28): marketing and analytics only ever read it through `hasConsent`.
 */
export async function recordConsent(
  raw: ConsentInput,
  options: { tx?: Tx; actor?: { id: string | null; type: 'staff' | 'customer' | 'system' }; leadId?: string | null } = {},
): Promise<ConsentRow> {
  const input = consentInputSchema.parse(raw);
  const run = async (tx: Tx) => {
    const [row] = await tx
      .insert(customersConsent)
      .values({
        userId: input.subject.userId ?? null,
        phoneHash: hashContact(input.subject.phone),
        emailHash: hashContact(input.subject.email),
        purpose: input.purpose,
        status: input.granted ? 'granted' : 'revoked',
        textShown: input.textShown,
        source: input.source,
        ipHash: input.ipHash ?? null,
        userAgent: input.userAgent ?? null,
      })
      .returning();
    await audit(
      {
        actorId: options.actor?.id ?? input.subject.userId ?? null,
        actorType: options.actor?.type ?? (input.subject.userId ? 'customer' : 'system'),
        action: input.granted ? 'consent.grant' : 'consent.revoke',
        entity: 'consent',
        entityId: row!.id,
        after: { purpose: row!.purpose, status: row!.status, source: row!.source, textShown: row!.textShown },
        ipHash: input.ipHash ?? null,
      },
      { tx },
    );
    await emit('consent.changed', { customerId: row!.userId, leadId: options.leadId ?? null, purpose: input.purpose, granted: input.granted }, { tx });
    return row!;
  };
  return options.tx ? run(options.tx) : withTx(run);
}

/** True when the newest row for any of the subject's identifiers grants the purpose. No row means no consent. */
export async function hasConsent(subject: ConsentSubject, purpose: ConsentPurpose): Promise<boolean> {
  const [latest] = await db
    .select({ status: customersConsent.status })
    .from(customersConsent)
    .where(and(subjectWhere(subject), eq(customersConsent.purpose, purpose)))
    .orderBy(desc(customersConsent.createdAt), desc(customersConsent.id))
    .limit(1);
  return latest?.status === 'granted';
}

/** Full history for one subject, newest first (account page and DPDP export). */
export async function consentHistory(subject: ConsentSubject): Promise<ConsentRow[]> {
  return db.select().from(customersConsent).where(subjectWhere(subject)).orderBy(desc(customersConsent.createdAt), desc(customersConsent.id));
}

/** Admin consent log (rows hold hashes only, never a plain phone or email). */
export async function listConsent(options: { purpose?: ConsentPurpose; page?: number; pageSize?: number } = {}): Promise<{ rows: ConsentRow[]; total: number }> {
  await requirePermission('customers.read');
  const pageSize = options.pageSize ?? 50;
  const where = options.purpose ? eq(customersConsent.purpose, options.purpose) : undefined;
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(customersConsent)
      .where(where)
      .orderBy(desc(customersConsent.createdAt), desc(customersConsent.id))
      .limit(pageSize)
      .offset(((options.page ?? 1) - 1) * pageSize),
    db.select({ n: count() }).from(customersConsent).where(where),
  ]);
  return { rows, total: total!.n };
}
