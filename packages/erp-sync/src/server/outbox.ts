// Orders and leads out: one outbox row per order or lead, pushed by a scheduled job with retry, backoff and dead letter.
import { audit } from '@ecomkit/core/audit';
import type { ErpAdapter, EventPayloads } from '@ecomkit/core/contracts';
import { db, withTx, type DbOrTx, type Tx } from '@ecomkit/core/db';
import { emit } from '@ecomkit/core/events';
import { integrationCall } from '@ecomkit/core/http';
import { captureError } from '@ecomkit/core/observability';
import { and, asc, count, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { backoffMs, erpLeadPayloadSchema, erpOrderPayloadSchema, pushLeadResultSchema, pushOrderResultSchema } from '../domain';
import { erpOutbox, erpSyncRun } from '../schema';
import { getPorts, resolveAdapter } from './ports';
import { loadSettings } from './settings';

export type OutboxKind = 'order' | 'lead';
export type OutboxRow = typeof erpOutbox.$inferSelect;

/** Idempotent: a second call for the same (kind, refId) changes nothing. Pass the caller's `tx` to write in its transaction. */
export async function enqueueOutbox(input: { kind: OutboxKind; refId: string }, options: { tx?: DbOrTx } = {}): Promise<{ created: boolean }> {
  const rows = await (options.tx ?? db)
    .insert(erpOutbox)
    .values({ kind: input.kind, refId: input.refId })
    .onConflictDoNothing({ target: [erpOutbox.kind, erpOutbox.refId] })
    .returning({ id: erpOutbox.id });
  return { created: rows.length > 0 };
}

// Event subscribers. Paid online orders arrive as order.paid; COD and pay-at-nursery orders as order.confirmed. Both
// land on the same row. Leads go out on lead.created only (enquiries never push directly).
export const onOrderPaid = async (p: EventPayloads['order.paid']) => void (await enqueueOutbox({ kind: 'order', refId: p.orderId }));
export const onOrderConfirmed = async (p: EventPayloads['order.confirmed']) => void (await enqueueOutbox({ kind: 'order', refId: p.orderId }));
export const onLeadCreated = async (p: EventPayloads['lead.created']) => void (await enqueueOutbox({ kind: 'lead', refId: p.leadId }));

export interface PushSummary {
  status: 'done' | 'disabled' | 'not_configured';
  sent: number;
  failed: number;
  dead: number;
  deferred: number;
}

type Outcome =
  | { kind: 'sent'; externalRef: string | null; invoiceNumber: string | null }
  | { kind: 'deferred'; reason: string }
  | { kind: 'failed'; error: string };

async function buildPayload(row: OutboxRow): Promise<{ payload: Record<string, unknown> } | { deferred: string } | { error: string }> {
  if (row.payload) return { payload: row.payload };
  const ports = getPorts();
  const source = row.kind === 'order' ? ports.orderPayload : ports.leadPayload;
  if (!source) return { deferred: `${row.kind} source not configured` };
  const raw = await source(row.refId);
  if (!raw) return { error: `${row.kind} ${row.refId} not found` };
  const parsed = (row.kind === 'order' ? erpOrderPayloadSchema : erpLeadPayloadSchema).safeParse(raw);
  if (!parsed.success) return { error: `invalid ${row.kind} payload: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`.slice(0, 900) };
  return { payload: parsed.data as Record<string, unknown> };
}

async function push(adapter: ErpAdapter, row: OutboxRow, payload: Record<string, unknown>): Promise<Outcome> {
  const provider = `erp:${adapter.id}`;
  if (row.kind === 'order') {
    const r = await integrationCall(provider, 'push-order', () => adapter.pushOrder(erpOrderPayloadSchema.parse(payload)), { ref: row.refId });
    if (r.status === 'skipped_not_configured') return { kind: 'deferred', reason: 'orders endpoint not configured' };
    if (r.status === 'failed') return { kind: 'failed', error: r.error.message };
    const out = pushOrderResultSchema.safeParse(r.value);
    return out.success ? { kind: 'sent', externalRef: out.data.opsOrderId, invoiceNumber: out.data.invoiceNumber } : { kind: 'failed', error: 'invalid push-order response' };
  }
  const r = await integrationCall(provider, 'push-lead', () => adapter.pushLead(erpLeadPayloadSchema.parse(payload)), { ref: row.refId });
  if (r.status === 'skipped_not_configured') return { kind: 'deferred', reason: 'lead intake not configured' };
  if (r.status === 'failed') return { kind: 'failed', error: r.error.message };
  const out = pushLeadResultSchema.safeParse(r.value);
  return out.success ? { kind: 'sent', externalRef: out.data.externalId, invoiceNumber: null } : { kind: 'failed', error: 'invalid push-lead response' };
}

/** `at` null = the database clock (JS dates are millisecond, timestamptz is microsecond: a row written this ms is due). */
async function claimNext(tx: Tx, at: Date | null): Promise<OutboxRow | undefined> {
  const [row] = await tx
    .select()
    .from(erpOutbox)
    .where(and(inArray(erpOutbox.status, ['pending', 'failed']), at ? lte(erpOutbox.nextAttemptAt, at) : sql`${erpOutbox.nextAttemptAt} <= clock_timestamp()`))
    .orderBy(asc(erpOutbox.nextAttemptAt), asc(erpOutbox.id))
    .limit(1)
    .for('update', { skipLocked: true });
  return row;
}

/**
 * Pushes due rows one by one, each in its own transaction holding the row lock (`skip locked`), so two workers
 * never push the same row. ERP-side idempotency on ecomOrderNumber covers a crash between push and commit.
 * ponytail: the row lock is held across the HTTP call (10 s timeout); fine at store volume, claim-then-push if it grows.
 */
export async function pushDue(options: { now?: Date; limit?: number } = {}): Promise<PushSummary> {
  const summary: PushSummary = { status: 'done', sent: 0, failed: 0, dead: 0, deferred: 0 };
  const settings = await loadSettings();
  if (!settings.enabled) return { ...summary, status: 'disabled' };
  const adapter = await resolveAdapter();
  if (!adapter) return { ...summary, status: 'not_configured' };
  const now = options.now ?? new Date();
  const sentRefs: { kind: OutboxKind; refId: string; externalRef: string | null; invoiceNumber: string | null }[] = [];
  const startedAt = new Date();

  for (let i = 0; i < (options.limit ?? 50); i++) {
    const done = await withTx(async (tx) => {
      const row = await claimNext(tx, options.now ?? null);
      if (!row) return true;
      const built = await buildPayload(row);
      let outcome: Outcome;
      if ('deferred' in built) outcome = { kind: 'deferred', reason: built.deferred };
      else if ('error' in built) outcome = { kind: 'failed', error: built.error };
      else outcome = await push(adapter, row, built.payload);
      const payload = 'payload' in built ? built.payload : row.payload;

      if (outcome.kind === 'sent') {
        await tx
          .update(erpOutbox)
          .set({ status: 'sent', payload, sentAt: now, externalRef: outcome.externalRef, invoiceNumber: outcome.invoiceNumber, lastError: null, updatedAt: now })
          .where(eq(erpOutbox.id, row.id));
        summary.sent++;
        sentRefs.push({ kind: row.kind, refId: row.refId, externalRef: outcome.externalRef, invoiceNumber: outcome.invoiceNumber });
      } else if (outcome.kind === 'deferred') {
        // Not configured on one side: wait without spending an attempt.
        const next = new Date(now.getTime() + settings.notConfiguredRetryMinutes * 60_000);
        await tx.update(erpOutbox).set({ status: 'pending', payload, lastError: outcome.reason, nextAttemptAt: next, updatedAt: now }).where(eq(erpOutbox.id, row.id));
        summary.deferred++;
      } else {
        const attempts = row.attempts + 1;
        const dead = attempts >= settings.maxAttempts;
        await tx
          .update(erpOutbox)
          .set({ status: dead ? 'dead' : 'failed', payload, attempts, lastError: outcome.error.slice(0, 1000), nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), updatedAt: now })
          .where(eq(erpOutbox.id, row.id));
        if (dead) {
          summary.dead++;
          await captureError(new Error(`ERP push moved to dead letter (${row.kind})`), { route: 'erp-sync.push-outbox', level: 'error' });
        } else summary.failed++;
      }
      return false;
    });
    if (done) break;
  }

  const onPushed = getPorts().onPushed;
  for (const ref of sentRefs) {
    try {
      await onPushed?.(ref);
    } catch (err) {
      await captureError(err, { route: 'erp-sync.on-pushed' });
    }
  }
  if (summary.sent + summary.failed + summary.dead > 0) {
    const [run] = await db
      .insert(erpSyncRun)
      .values({
        direction: 'orders_out',
        transport: adapter.id,
        startedAt,
        finishedAt: new Date(),
        items: summary.sent + summary.failed + summary.dead,
        changed: summary.sent,
        errors: summary.failed + summary.dead,
        log: { ...summary },
      })
      .returning({ id: erpSyncRun.id });
    const orders = sentRefs.filter((r) => r.kind === 'order').length;
    const leads = sentRefs.length - orders;
    if (orders) await emit('erp.synced', { runId: run!.id, kind: 'orders', changed: orders });
    if (leads) await emit('erp.synced', { runId: run!.id, kind: 'leads', changed: leads });
  }
  return summary;
}

/** Puts a failed or dead row back in the queue with a fresh attempt budget. */
export async function retryOutbox(id: string, actorId: string): Promise<boolean> {
  return withTx(async (tx) => {
    const [before] = await tx.select().from(erpOutbox).where(eq(erpOutbox.id, id)).for('update');
    if (!before || before.status === 'sent') return false;
    await tx.update(erpOutbox).set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), updatedAt: new Date() }).where(eq(erpOutbox.id, id));
    await audit({ actorId, actorType: 'staff', action: 'erp.outbox.retry', entity: 'erp_outbox', entityId: id, before: { status: before.status, attempts: before.attempts }, after: { status: 'pending' } }, { tx });
    return true;
  });
}

/** The ERP-side id for an order once pushed (orders reads this instead of querying erp_* tables). */
export async function erpRefFor(orderId: string): Promise<{ status: OutboxRow['status']; externalRef: string | null; invoiceNumber: string | null } | null> {
  const [row] = await db
    .select({ status: erpOutbox.status, externalRef: erpOutbox.externalRef, invoiceNumber: erpOutbox.invoiceNumber })
    .from(erpOutbox)
    .where(and(eq(erpOutbox.kind, 'order'), eq(erpOutbox.refId, orderId)));
  return row ?? null;
}

export async function outboxCounts(): Promise<{ waitingOrders: number; waitingLeads: number; dead: number }> {
  const rows = await db.select({ kind: erpOutbox.kind, status: erpOutbox.status, n: count() }).from(erpOutbox).where(ne(erpOutbox.status, 'sent')).groupBy(erpOutbox.kind, erpOutbox.status);
  const sum = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).reduce((a, r) => a + r.n, 0);
  return {
    waitingOrders: sum((r) => r.kind === 'order' && r.status !== 'dead'),
    waitingLeads: sum((r) => r.kind === 'lead' && r.status !== 'dead'),
    dead: sum((r) => r.status === 'dead'),
  };
}

export async function listOutbox(options: { includeSent?: boolean; limit?: number } = {}): Promise<OutboxRow[]> {
  return db
    .select()
    .from(erpOutbox)
    .where(options.includeSent ? undefined : ne(erpOutbox.status, 'sent'))
    .orderBy(desc(erpOutbox.createdAt), desc(erpOutbox.id))
    .limit(Math.min(options.limit ?? 100, 500));
}

/**
 * Orders not yet in the ERP, as rows for the manual bridge (CSV) until the ops endpoint exists.
 * Builds and stores the payload for rows that have none yet.
 */
export async function pendingOrderRows(): Promise<string[][]> {
  const rows = await db
    .select()
    .from(erpOutbox)
    .where(and(eq(erpOutbox.kind, 'order'), ne(erpOutbox.status, 'sent')))
    .orderBy(asc(erpOutbox.createdAt));
  const out: string[][] = [
    ['order_number', 'placed_at', 'customer', 'phone', 'email', 'gstin', 'method', 'slot_date', 'district', 'address', 'lines', 'total_paise', 'paid_paise', 'order_status', 'sync_status', 'attempts', 'last_error'],
  ];
  for (const row of rows) {
    let payload = row.payload;
    if (!payload) {
      const built = await buildPayload(row);
      if ('payload' in built) {
        payload = built.payload;
        await db.update(erpOutbox).set({ payload }).where(and(eq(erpOutbox.id, row.id), sql`${erpOutbox.payload} is null`));
      }
    }
    const p = payload ? erpOrderPayloadSchema.safeParse(payload) : null;
    const o = p?.success ? p.data : null;
    out.push([
      o?.ecomOrderNumber ?? row.refId,
      o?.placedAt ?? '',
      o?.customer.name ?? '',
      o?.customer.phone ?? '',
      o?.customer.email ?? '',
      o?.customer.gstin ?? '',
      o?.deliver.method ?? '',
      o?.deliver.slotDate ?? '',
      o?.deliver.district ?? '',
      o?.deliver.address ?? '',
      o ? o.lines.map((l) => `${l.sku || l.name} x ${l.qty}`).join('; ') : '',
      o ? String(o.totals.totalPaise) : '',
      o ? String(o.totals.paidPaise) : '',
      o?.status ?? '',
      row.status,
      String(row.attempts),
      row.lastError ?? '',
    ]);
  }
  return out;
}
