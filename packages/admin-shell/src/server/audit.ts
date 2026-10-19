import { listAudit, type AuditRow } from '@ecomkit/core/audit';
import { z } from 'zod';

const PAGE = 50;
const text = z.string().trim().max(120).optional().catch(undefined);
const paramsSchema = z.object({
  entity: text,
  entityId: text,
  before: z.iso.datetime({ offset: true }).optional().catch(undefined),
});
export type AuditParams = z.infer<typeof paramsSchema>;

/**
 * Audit viewer page: newest first, filtered by entity and id, 50 rows per page, keyset on created_at
 * (`before` = the last row shown). Query values are validated; anything malformed is ignored.
 * ponytail: the keyset is on milliseconds, so two rows written in the same millisecond at a page edge can hide
 * one; switch core listAudit to an (created_at, id) cursor if that ever matters.
 */
export async function loadAudit(searchParams: Record<string, string | string[] | undefined>): Promise<{ rows: AuditRow[]; older: string | null; params: AuditParams }> {
  const first = (k: string) => [searchParams[k]].flat()[0] || undefined;
  const params = paramsSchema.parse({ entity: first('entity'), entityId: first('entityId'), before: first('before') });
  const rows = await listAudit({ entity: params.entity, entityId: params.entityId, before: params.before ? new Date(params.before) : undefined, limit: PAGE + 1 });
  const page = rows.slice(0, PAGE);
  return { rows: page, older: rows.length > PAGE ? page.at(-1)!.createdAt.toISOString() : null, params };
}
