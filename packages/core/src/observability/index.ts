import { createHash } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Instrumentation } from 'next';
import type { Logger } from '../contracts';
import { db, upsertRequireUpdate } from '../db';
import { coreErrorEvent, coreErrorIssue, coreIntegrationLog } from '../schema';

export type IssueStatus = (typeof coreErrorIssue.$inferSelect)['status'];
export type ErrorIssue = typeof coreErrorIssue.$inferSelect;

/** JSON-lines logger: one object per line on stdout (info) or stderr (warn, error). */
export function createLogger(scope: string, base: Record<string, unknown> = {}): Logger {
  const write = (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, scope, message, ...base, ...data });
    if (level === 'info') process.stdout.write(`${line}\n`);
    else process.stderr.write(`${line}\n`);
  };
  return {
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}

const log = createLogger('observability');

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === 'string' ? err : JSON.stringify(err) ?? String(err));
}

/** First `at ...` stack frame with line/column numbers, query strings and build hashes removed, so it survives redeploys. */
export function topFrame(stack: string | undefined): string {
  const frame = stack?.split('\n').find((l) => /^\s*at /.test(l));
  if (!frame) return '';
  return frame
    .trim()
    .replace(/:\d+:\d+\)?$/, '')
    .replace(/\?[^\s)]*/g, '')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')
    .replace(/^at /, '');
}

/** Groups errors into issues: hash of error name + normalised top frame + route. The message is left out on purpose (ids, amounts). */
export function fingerprint(err: unknown, route?: string | null): string {
  const e = toError(err);
  return createHash('sha256').update(`${e.name}\n${topFrame(e.stack)}\n${route ?? ''}`).digest('hex').slice(0, 32);
}

export interface ErrorContext {
  route?: string | null;
  method?: string | null;
  /** Query strings are dropped before storing (they can carry tokens). */
  url?: string | null;
  requestId?: string | null;
  viewerRole?: string | null;
  release?: string | null;
  level?: 'error' | 'warning';
}

/**
 * Records an error as an event under its issue (created on first sight, reopened if it was resolved).
 * Never throws: observability must not take a request down. Returns the issue id, or null if recording failed.
 */
export async function captureError(err: unknown, ctx: ErrorContext = {}): Promise<string | null> {
  const e = toError(err);
  try {
    const release = ctx.release ?? process.env.GIT_SHA ?? null;
    const [issue] = await upsertRequireUpdate(
      db,
      coreErrorIssue,
      { fingerprint: fingerprint(e, ctx.route), title: `${e.name}: ${e.message}`.slice(0, 300), level: ctx.level ?? 'error', release },
      {
        target: coreErrorIssue.fingerprint,
        set: {
          lastSeen: sql`now()`,
          count: sql`${coreErrorIssue.count} + 1`,
          release,
          status: sql`case when ${coreErrorIssue.status} = 'resolved' then 'open'::core_issue_status else ${coreErrorIssue.status} end`,
        },
      },
    );
    await db.insert(coreErrorEvent).values({
      issueId: issue!.id,
      message: e.message.slice(0, 2000),
      stack: e.stack?.slice(0, 8000) ?? null,
      route: ctx.route ?? null,
      method: ctx.method ?? null,
      url: ctx.url ? ctx.url.split('?')[0]! : null,
      requestId: ctx.requestId ?? null,
      viewerRole: ctx.viewerRole ?? null,
      release,
    });
    return issue!.id;
  } catch (recordError) {
    log.error('could not record error', { original: e.message, stack: e.stack, recordError: String(recordError) });
    return null;
  }
}

/** Next `instrumentation.ts` hook: `export const onRequestError = captureRequestError;` */
export const captureRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const requestId = request.headers['x-request-id'];
  await captureError(error, {
    route: context.routePath,
    method: request.method,
    url: request.path,
    requestId: Array.isArray(requestId) ? requestId[0] : requestId,
  });
};

/** Times `fn`; logs a warning when it takes longer than `slowMs`. Errors pass through untouched. */
export async function withSpan<T>(name: string, fn: () => Promise<T>, options: { slowMs?: number; logger?: Logger } = {}): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - started);
    if (ms >= (options.slowMs ?? 1000)) (options.logger ?? log).warn('slow span', { span: name, ms });
  }
}

/** Issue list for the monitoring screens, newest activity first. */
export async function listErrorIssues(options: { status?: IssueStatus; limit?: number; before?: Date } = {}): Promise<ErrorIssue[]> {
  const where = and(
    options.status ? eq(coreErrorIssue.status, options.status) : undefined,
    options.before ? lt(coreErrorIssue.lastSeen, options.before) : undefined,
  );
  return db
    .select()
    .from(coreErrorIssue)
    .where(where)
    .orderBy(desc(coreErrorIssue.lastSeen), desc(coreErrorIssue.id))
    .limit(options.limit ?? 50);
}

export async function setIssueStatus(issueId: string, status: IssueStatus): Promise<void> {
  await db.update(coreErrorIssue).set({ status }).where(eq(coreErrorIssue.id, issueId));
}

/** Retention: error events after 30 days, integration log after 90 (issues stay, with their counts). */
export async function pruneObservability(now = new Date()): Promise<{ errorEvents: number; integrationLog: number }> {
  const day = 86_400_000;
  const events = await db.delete(coreErrorEvent).where(lt(coreErrorEvent.createdAt, new Date(now.getTime() - 30 * day)));
  const integ = await db.delete(coreIntegrationLog).where(lt(coreIntegrationLog.createdAt, new Date(now.getTime() - 90 * day)));
  return { errorEvents: events.rowCount ?? 0, integrationLog: integ.rowCount ?? 0 };
}

/** Plan name for the same adapter. */
export const onRequestError = captureRequestError;
