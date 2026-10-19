// Health check registry and runner: monitoring's own readiness checks, checks registered in-process, and the
// `healthChecks` extension point of every enabled module.
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import type { HealthCheck, HealthResult } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { coreJobHeartbeat } from '@ecomkit/core/schema';
import { sql } from 'drizzle-orm';
import { diskHealth, heartbeatHealth, overallStatus, splitList } from '../domain';
import { monitoringCheckResult } from '../schema';
import { getRuntime } from './runtime';
import { monitoringSettings } from './settings';

export const CHECK_TIMEOUT_MS = 5000;

const databaseCheck = async (): Promise<HealthResult> => {
  await db.execute(sql`select 1`);
  return { status: 'ok' };
};

const workerCheck = async (): Promise<HealthResult> => {
  const [row] = await db.select({ last: sql<Date | null>`max(${coreJobHeartbeat.lastSeen})` }).from(coreJobHeartbeat);
  return heartbeatHealth(row?.last ? new Date(row.last) : null, new Date());
};

const diskCheck = async (): Promise<HealthResult> => {
  const paths = splitList((await monitoringSettings()).diskPaths);
  const disks = await Promise.all(
    (paths.length ? paths : [process.cwd()]).map(async (path) => {
      const space = await getRuntime().statDisk(path);
      const writable = await access(path, constants.W_OK).then(
        () => true,
        () => false,
      );
      return { path, ...space, writable };
    }),
  );
  return diskHealth(disks);
};

/** Readiness basics owned by monitoring (plan section 7): DB round trip, worker heartbeat age, disk free and writable folders. */
export const BUILTIN_CHECKS: readonly HealthCheck[] = [
  { id: 'monitoring.database', label: 'Database', critical: true, readiness: true, run: async () => databaseCheck },
  { id: 'monitoring.worker', label: 'Job worker heartbeat', critical: true, readiness: true, run: async () => workerCheck },
  { id: 'monitoring.disk', label: 'Disk space and writable folders', critical: true, readiness: true, run: async () => diskCheck },
];

const registered = new Map<string, HealthCheck>();

/** Adds a check from code that is not a module manifest (the host app). Same id replaces. */
export function registerHealthCheck(check: HealthCheck): void {
  registered.set(check.id, check);
}

/** Built-ins, then registered, then manifest checks; first id wins. */
export function allChecks(): HealthCheck[] {
  const byId = new Map<string, HealthCheck>();
  for (const c of [...BUILTIN_CHECKS, ...registered.values(), ...(getRuntime().registry?.list('healthChecks') ?? [])]) if (!byId.has(c.id)) byId.set(c.id, c);
  return [...byId.values()];
}

export interface CheckOutcome extends HealthResult {
  id: string;
  label: string;
  critical: boolean;
  readiness: boolean;
  latencyMs: number;
}

/** Runs one check with a timeout; a throw or a timeout is `down` with the reason. */
export async function runCheck(check: HealthCheck, timeoutMs = CHECK_TIMEOUT_MS): Promise<CheckOutcome> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  let result: HealthResult;
  try {
    const fn = await check.run();
    result = await Promise.race([
      fn(),
      new Promise<HealthResult>((resolve) => {
        timer = setTimeout(() => resolve({ status: 'down', detail: `no answer within ${timeoutMs} ms` }), timeoutMs);
      }),
    ]);
  } catch (err) {
    result = { status: 'down', detail: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = result.latencyMs ?? Math.round(performance.now() - started);
  return { id: check.id, label: check.label, critical: check.critical, readiness: check.readiness, ...result, latencyMs };
}

export const isOk = (status: HealthResult['status']) => status === 'ok' || status === 'not_configured';

export async function recordCheck(check: string, ok: boolean, options: { latencyMs?: number | null; detail?: Record<string, unknown> | null; now?: Date } = {}): Promise<void> {
  await db.insert(monitoringCheckResult).values({ check, ok, latencyMs: options.latencyMs ?? null, detail: options.detail ?? null, createdAt: options.now ?? new Date() });
}

/** Runs checks in parallel; `record` writes one monitoring_check_result row per check (the worker does, HTTP probes do not). */
export async function runChecks(options: { readinessOnly?: boolean; record?: boolean; now?: Date } = {}): Promise<CheckOutcome[]> {
  const checks = allChecks().filter((c) => !options.readinessOnly || c.readiness);
  const results = await Promise.all(checks.map((c) => runCheck(c)));
  if (options.record && results.length) {
    await db.insert(monitoringCheckResult).values(
      results.map((r) => ({ check: r.id, ok: isOk(r.status), latencyMs: r.latencyMs, detail: { status: r.status, ...(r.detail ? { detail: r.detail } : {}) }, createdAt: options.now ?? new Date() })),
    );
  }
  return results;
}

export interface Readiness {
  status: 'ok' | 'degraded' | 'down';
  checks: { id: string; status: HealthResult['status'] }[];
}

let cached: { at: number; value: Promise<Readiness> } | null = null;
/** ponytail: one in-process memo, so an external pinger cannot turn /api/health/ready into a load test. */
const READY_MEMO_MS = 5000;

/** Readiness summary for /api/health/ready: ids and statuses only, never details. */
export function readiness(options: { fresh?: boolean } = {}): Promise<Readiness> {
  if (!options.fresh && cached && Date.now() - cached.at < READY_MEMO_MS) return cached.value;
  const value = runChecks({ readinessOnly: true }).then((results) => ({ status: overallStatus(results), checks: results.map((r) => ({ id: r.id, status: r.status })) }));
  cached = { at: Date.now(), value };
  return value;
}
