// Read models for the Health screens. Core observability tables (errors, integration log, heartbeat) are read
// through core's exported schema; the job queue through pg-boss.
import { audit } from '@ecomkit/core/audit';
import { db } from '@ecomkit/core/db';
import { getBoss } from '@ecomkit/core/jobs';
import { setIssueStatus, type IssueStatus } from '@ecomkit/core/observability';
import { coreErrorEvent, coreErrorIssue, coreIntegrationLog, coreJobHeartbeat } from '@ecomkit/core/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { monitoringCheckResult } from '../schema';

const HOUR = 3_600_000;

export type CheckResultRow = typeof monitoringCheckResult.$inferSelect;

/** Latest recorded result per check. */
export async function latestCheckResults(): Promise<CheckResultRow[]> {
  const { rows } = await db.execute<{ id: number; check: string; ok: boolean; latency_ms: number | null; detail: unknown; created_at: string | Date }>(
    sql`select distinct on ("check") id, "check", ok, latency_ms, detail, created_at from monitoring_check_result order by "check", created_at desc`,
  );
  return rows.map((r) => ({ id: Number(r.id), check: r.check, ok: r.ok, latencyMs: r.latency_ms, detail: r.detail, createdAt: new Date(r.created_at) }));
}

/** Hourly share of ok results for one check, oldest first (null where nothing was recorded). */
export async function checkHistory(check: string, options: { hours?: number; now?: Date } = {}): Promise<{ hourly: (number | null)[]; okRatio: number | null }> {
  const hours = options.hours ?? 24;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - hours * HOUR);
  const rows = await db
    .select({ bucket: sql<number>`floor(extract(epoch from (${now} - ${monitoringCheckResult.createdAt})) / 3600)::int`, ok: sql<number>`count(*) filter (where ${monitoringCheckResult.ok})::int`, n: sql<number>`count(*)::int` })
    .from(monitoringCheckResult)
    .where(and(eq(monitoringCheckResult.check, check), sql`${monitoringCheckResult.createdAt} > ${since}`))
    .groupBy(sql`1`);
  const hourly: (number | null)[] = Array.from({ length: hours }, () => null);
  let ok = 0;
  let n = 0;
  for (const r of rows) {
    const i = hours - 1 - r.bucket;
    if (i >= 0 && i < hours) hourly[i] = r.ok / r.n;
    ok += r.ok;
    n += r.n;
  }
  return { hourly, okRatio: n ? ok / n : null };
}

export interface IntegrationCard {
  provider: string;
  mode: 'live' | 'not_configured';
  calls24h: number;
  failed24h: number;
  errorRate24h: number | null;
  avgLatencyMs: number | null;
  lastOkAt: Date | null;
  lastFailedAt: Date | null;
  lastError: string | null;
}

/** One card per provider seen in the integration log over 30 days. */
export async function integrationCards(options: { now?: Date } = {}): Promise<IntegrationCard[]> {
  const now = options.now ?? new Date();
  const day = new Date(now.getTime() - 24 * HOUR);
  const l = coreIntegrationLog;
  const rows = await db
    .select({
      provider: l.provider,
      calls: sql<number>`count(*) filter (where ${l.createdAt} > ${day} and ${l.status} <> 'skipped_not_configured')::int`,
      failed: sql<number>`count(*) filter (where ${l.createdAt} > ${day} and ${l.status} = 'failed')::int`,
      avgMs: sql<number | null>`(avg(${l.durationMs}) filter (where ${l.createdAt} > ${day} and ${l.status} = 'ok'))::int`,
      lastOk: sql<string | null>`max(${l.createdAt}) filter (where ${l.status} = 'ok')`,
      lastFailed: sql<string | null>`max(${l.createdAt}) filter (where ${l.status} = 'failed')`,
      lastStatus: sql<string>`(array_agg(${l.status} order by ${l.createdAt} desc, ${l.id} desc))[1]`,
      lastError: sql<string | null>`(array_agg(${l.error} order by ${l.createdAt} desc, ${l.id} desc) filter (where ${l.status} = 'failed'))[1]`,
    })
    .from(l)
    .where(sql`${l.createdAt} > ${new Date(now.getTime() - 30 * 24 * HOUR)}`)
    .groupBy(l.provider)
    .orderBy(l.provider);
  return rows.map((r) => ({
    provider: r.provider,
    mode: r.lastStatus === 'skipped_not_configured' ? 'not_configured' : 'live',
    calls24h: r.calls,
    failed24h: r.failed,
    errorRate24h: r.calls ? r.failed / r.calls : null,
    avgLatencyMs: r.avgMs,
    lastOkAt: r.lastOk ? new Date(r.lastOk) : null,
    lastFailedAt: r.lastFailed ? new Date(r.lastFailed) : null,
    lastError: r.lastError,
  }));
}

export const LOG_TYPES = ['integration', 'checks'] as const;
export type LogType = (typeof LOG_TYPES)[number];

export async function listIntegrationLog(options: { provider?: string; status?: 'ok' | 'failed' | 'skipped_not_configured'; page?: number; pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 50;
  const where = and(options.provider ? eq(coreIntegrationLog.provider, options.provider) : undefined, options.status ? eq(coreIntegrationLog.status, options.status) : undefined);
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(coreIntegrationLog)
      .where(where)
      .orderBy(desc(coreIntegrationLog.createdAt), desc(coreIntegrationLog.id))
      .limit(pageSize)
      .offset(((options.page ?? 1) - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(coreIntegrationLog).where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

export async function listCheckLog(options: { check?: string; failedOnly?: boolean; page?: number; pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 50;
  const where = and(options.check ? eq(monitoringCheckResult.check, options.check) : undefined, options.failedOnly ? eq(monitoringCheckResult.ok, false) : undefined);
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(monitoringCheckResult)
      .where(where)
      .orderBy(desc(monitoringCheckResult.createdAt), desc(monitoringCheckResult.id))
      .limit(pageSize)
      .offset(((options.page ?? 1) - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(monitoringCheckResult).where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

export async function providers(): Promise<string[]> {
  const rows = await db.selectDistinct({ p: coreIntegrationLog.provider }).from(coreIntegrationLog).orderBy(coreIntegrationLog.provider);
  return rows.map((r) => r.p);
}

// ---- jobs ----------------------------------------------------------------------

export interface QueueRow {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  /** Jobs parked in `<name>.dead`. */
  dead: number;
}

export interface FailedJob {
  id: string;
  queue: string;
  state: string;
  retryCount: number;
  createdOn: Date;
  completedOn: Date | null;
  error: string | null;
  /** For a dead-lettered job, the queue it failed on. */
  sourceName: string | null;
}

async function jobSchemaReady(): Promise<boolean> {
  const { rows } = await db.execute<{ t: string | null }>(sql`select to_regclass('pgboss.job')::text as t`);
  return !!rows[0]?.t;
}

/** Queue counts straight from the job table (the worker may be down; this page must still load). */
export async function listQueues(): Promise<QueueRow[]> {
  if (!(await jobSchemaReady())) return [];
  const { rows } = await db.execute<{ name: string; waiting: number; active: number; failed: number }>(sql`
    select name,
      count(*) filter (where state in ('created', 'retry'))::int as waiting,
      count(*) filter (where state = 'active')::int as active,
      count(*) filter (where state = 'failed')::int as failed
    from pgboss.job group by name order by name`);
  const dead = new Map(rows.filter((r) => r.name.endsWith('.dead')).map((r) => [r.name.slice(0, -5), r.waiting]));
  return rows.filter((r) => !r.name.endsWith('.dead')).map((r) => ({ ...r, dead: dead.get(r.name) ?? 0 }));
}

function errorOf(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const o = output as { message?: unknown; value?: unknown };
  const text = typeof o.message === 'string' ? o.message : typeof o.value === 'string' ? o.value : JSON.stringify(output);
  return text.slice(0, 500);
}

/** Failed jobs and dead-lettered jobs waiting for a decision, newest first. */
export async function listFailedJobs(options: { limit?: number } = {}): Promise<FailedJob[]> {
  if (!(await jobSchemaReady())) return [];
  const { rows } = await db.execute<{ id: string; name: string; state: string; retry_count: number; created_on: string | Date; completed_on: string | Date | null; output: unknown; source_name: string | null }>(sql`
    select id, name, state, retry_count, created_on, completed_on, output, source_name from pgboss.job
    where state = 'failed' or (name like '%.dead' and state = 'created')
    order by created_on desc limit ${options.limit ?? 100}`);
  return rows.map((r) => ({
    id: r.id,
    queue: r.name,
    state: r.state,
    retryCount: r.retry_count,
    createdOn: new Date(r.created_on),
    completedOn: r.completed_on ? new Date(r.completed_on) : null,
    error: errorOf(r.output),
    sourceName: r.source_name,
  }));
}

export const retryJobSchema = z.object({ queue: z.string().min(1).max(200), id: z.uuid() });

/** Failed job: back into its queue. Dead-lettered job (`<queue>.dead`, core's naming): redriven to `<queue>`. */
export async function retryJob(input: z.input<typeof retryJobSchema>, actorId: string | null): Promise<boolean> {
  const { queue, id } = retryJobSchema.parse(input);
  const boss = await getBoss();
  // retry() reports `affected` at runtime; its declared type is an empty interface.
  const moved = queue.endsWith('.dead') ? await boss.redrive(queue, { ids: [id], destination: queue.slice(0, -'.dead'.length) }) : (((await boss.retry(queue, id)) as { affected?: number }).affected ?? 0);
  if (moved) await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'job.retry', entity: 'job', entityId: `${queue}/${id}` });
  return moved > 0;
}

export async function heartbeats() {
  return db.select().from(coreJobHeartbeat).orderBy(desc(coreJobHeartbeat.lastSeen));
}

// ---- errors --------------------------------------------------------------------

export const ISSUE_STATUSES = ['open', 'resolved', 'ignored'] as const;

export async function listIssues(options: { status?: IssueStatus; page?: number; pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 50;
  const where = options.status ? eq(coreErrorIssue.status, options.status) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(coreErrorIssue)
      .where(where)
      .orderBy(desc(coreErrorIssue.lastSeen), desc(coreErrorIssue.id))
      .limit(pageSize)
      .offset(((options.page ?? 1) - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(coreErrorIssue).where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

export async function getIssue(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [issue] = await db.select().from(coreErrorIssue).where(eq(coreErrorIssue.id, id));
  if (!issue) return null;
  const events = await db.select().from(coreErrorEvent).where(eq(coreErrorEvent.issueId, id)).orderBy(desc(coreErrorEvent.createdAt), desc(coreErrorEvent.id)).limit(20);
  return { issue, events };
}

export const issueStatusSchema = z.object({ id: z.uuid(), status: z.enum(ISSUE_STATUSES) });

/** Resolve, ignore or reopen an error issue. The matching `error.issue` alert follows on the next scan. */
export async function setErrorIssueStatus(input: z.input<typeof issueStatusSchema>, actorId: string | null): Promise<void> {
  const { id, status } = issueStatusSchema.parse(input);
  await setIssueStatus(id, status);
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: `error_issue.${status}`, entity: 'core_error_issue', entityId: id });
}
