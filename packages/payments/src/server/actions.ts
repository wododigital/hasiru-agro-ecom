// Settings actions, health checks and the admin list queries.
import type { HealthResult, SettingsActionResult } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { coreIntegrationLog } from '@ecomkit/core/schema';
import { and, count, desc, eq, getTableColumns, gt, ilike, lt, sql, type SQL } from 'drizzle-orm';
import { paymentsAttempt, paymentsRefund, type PaymentAttemptRow, type PaymentRefundRow } from '../schema';
import { loadSettings, webhookCredentials, webhookUrl } from './config';
import { phonepeProvider } from './phonepe';

/** Settings action "Test connection": requests a fresh token with the saved credentials. */
export async function testConnectionAction(): Promise<SettingsActionResult> {
  const s = await loadSettings();
  const result = await phonepeProvider(s, s.mode).testConnection!();
  const hook = webhookCredentials(s) ? 'Webhook credentials set.' : 'Webhook username and password are missing: webhooks will be refused (the status poll still reconciles).';
  return { ...result, message: `${result.message} ${hook}`, detail: { mode: s.mode, webhookUrl: webhookUrl() } };
}

/** Gateway configuration and the last hour's failure rate of gateway calls. */
export async function gatewayHealth(): Promise<HealthResult> {
  const s = await loadSettings();
  if (s.mode !== 'mock' && (!s.clientId || !s.clientSecret)) return { status: 'not_configured', detail: `${s.mode} mode without client credentials` };
  const provider = s.mode === 'mock' ? 'mock' : 'phonepe';
  const [row] = await db
    .select({ total: count(), failed: sql<number>`count(*) filter (where ${coreIntegrationLog.status} = 'failed')::int` })
    .from(coreIntegrationLog)
    .where(and(eq(coreIntegrationLog.provider, provider), gt(coreIntegrationLog.createdAt, new Date(Date.now() - 3_600_000))));
  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  if (total >= 5 && failed / total > 0.2) return { status: 'degraded', detail: `${failed} of ${total} gateway calls failed in the last hour` };
  if (s.mode === 'mock' && process.env.NODE_ENV === 'production') return { status: 'degraded', detail: 'Payments are in mock mode' };
  return { status: 'ok', detail: `${s.mode} mode` };
}

/** Critical: money waiting on a refund decision, or open attempts the sweep has not closed (the worker is not running). */
export async function anomalyHealth(): Promise<HealthResult> {
  const [tasks] = await db.select({ n: count() }).from(paymentsRefund).where(eq(paymentsRefund.state, 'task'));
  const [stuck] = await db
    .select({ n: count() })
    .from(paymentsAttempt)
    .where(and(eq(paymentsAttempt.state, 'pending'), lt(paymentsAttempt.expiresAt, new Date(Date.now() - 15 * 60_000))));
  if (Number(stuck?.n ?? 0) > 0) return { status: 'down', detail: `${stuck!.n} payment attempts are past their window and still open` };
  if (Number(tasks?.n ?? 0) > 0) return { status: 'degraded', detail: `${tasks!.n} refund tasks waiting on the payments page` };
  return { status: 'ok' };
}

// ---- admin queries -------------------------------------------------------------------------------------------------

export const ATTEMPT_STATES = ['pending', 'completed', 'failed', 'expired'] as const;
export const ATTEMPT_PROVIDERS = ['phonepe', 'mock', 'bank_transfer'] as const;

export async function listAttempts(params: { q: string; state?: string; provider?: string; page: number; pageSize: number }): Promise<{ rows: PaymentAttemptRow[]; total: number }> {
  const where: SQL[] = [];
  if (params.q) where.push(ilike(paymentsAttempt.merchantOrderId, `%${params.q.replace(/[%_\\]/g, '\\$&')}%`));
  if (params.state) where.push(eq(paymentsAttempt.state, params.state as PaymentAttemptRow['state']));
  if (params.provider) where.push(eq(paymentsAttempt.provider, params.provider as PaymentAttemptRow['provider']));
  const cond = where.length ? and(...where) : undefined;
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(paymentsAttempt)
      .where(cond)
      .orderBy(desc(paymentsAttempt.createdAt), desc(paymentsAttempt.id))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ n: count() }).from(paymentsAttempt).where(cond),
  ]);
  return { rows, total: Number(total?.n ?? 0) };
}

/** Refund tasks first (they need a decision), then refunds still settling, then the latest settled ones. */
export async function listRefunds(limit = 50): Promise<(PaymentRefundRow & { merchantOrderId: string })[]> {
  return db
    .select({ ...getTableColumns(paymentsRefund), merchantOrderId: paymentsAttempt.merchantOrderId })
    .from(paymentsRefund)
    .innerJoin(paymentsAttempt, eq(paymentsAttempt.id, paymentsRefund.attemptId))
    .orderBy(sql`case ${paymentsRefund.state} when 'task' then 0 when 'pending' then 1 else 2 end`, desc(paymentsRefund.createdAt))
    .limit(limit);
}

/** Open bank transfers waiting for staff to confirm receipt. */
export async function listOpenBankTransfers(): Promise<PaymentAttemptRow[]> {
  return db
    .select()
    .from(paymentsAttempt)
    .where(and(eq(paymentsAttempt.provider, 'bank_transfer'), eq(paymentsAttempt.state, 'pending')))
    .orderBy(desc(paymentsAttempt.createdAt))
    .limit(100);
}

/** Attempts of one order (orders admin timeline / detail page). */
export async function attemptsForOrder(orderId: string): Promise<PaymentAttemptRow[]> {
  return db.select().from(paymentsAttempt).where(eq(paymentsAttempt.orderId, orderId)).orderBy(desc(paymentsAttempt.attemptNo));
}
