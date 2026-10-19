import { and, desc, eq, lt } from 'drizzle-orm';
import { db, type DbOrTx } from '../db';
import { coreAuditLog } from '../schema';

export { hashIp } from '../http/secrets';

export interface AuditEntry {
  actorId: string | null;
  actorType: 'staff' | 'customer' | 'system';
  /** `<entity>.<verb>`, e.g. `product.update`, `order.refund`, `settings.update`. */
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** From `hashIp(ip)`; raw IPs are never stored. */
  ipHash?: string | null;
}

/** Append-only audit history (the app role has INSERT + SELECT only on this table). Pass `tx` so the row commits with the change. */
export async function audit(entry: AuditEntry, options: { tx?: DbOrTx } = {}): Promise<void> {
  await (options.tx ?? db).insert(coreAuditLog).values({
    actorId: entry.actorId,
    actorType: entry.actorType,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ipHash: entry.ipHash ?? null,
  });
}

export type AuditRow = typeof coreAuditLog.$inferSelect;

/** Audit viewer query: one entity's history or everything, newest first, keyset on created_at. */
export async function listAudit(options: { entity?: string; entityId?: string; before?: Date; limit?: number } = {}): Promise<AuditRow[]> {
  return db
    .select()
    .from(coreAuditLog)
    .where(
      and(
        options.entity ? eq(coreAuditLog.entity, options.entity) : undefined,
        options.entityId ? eq(coreAuditLog.entityId, options.entityId) : undefined,
        options.before ? lt(coreAuditLog.createdAt, options.before) : undefined,
      ),
    )
    .orderBy(desc(coreAuditLog.createdAt), desc(coreAuditLog.id))
    .limit(options.limit ?? 50);
}
