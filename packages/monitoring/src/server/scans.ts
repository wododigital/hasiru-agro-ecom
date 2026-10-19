// What the worker looks at every minute (health checks, errors, jobs, integrations, liveness) and once a day
// (certificates, domain registration, DNS, backups, database). Each scan turns what it sees into alert issues
// through `reconcile`, so a condition raises once and resolves when it clears.
import { resolveMx, resolveTxt, resolve4 } from 'node:dns/promises';
import { connect } from 'node:tls';
import type { EventHandler } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { env } from '@ecomkit/core/env';
import { safeFetch } from '@ecomkit/core/http';
import { captureError } from '@ecomkit/core/observability';
import { coreErrorEvent, coreErrorIssue, coreIntegrationLog } from '@ecomkit/core/schema';
import { and, desc, eq, gt, lt, ne, sql } from 'drizzle-orm';
import {
  CERT_MIN_DAYS,
  DOMAIN_MIN_DAYS,
  dnsMissing,
  expiryProblem,
  isCriticalRoute,
  rdapExpiry,
  splitList,
  type DnsSnapshot,
  type MonitoringSettings,
} from '../domain';
import { monitoringAlert, monitoringCheckResult } from '../schema';
import { alert, reconcile, resolveAlert, sendRepeats, type ActiveCondition } from './alerts';
import { recordCheck, runChecks } from './checks';
import { monitoringSettings } from './settings';

const MINUTE = 60_000;

/** Health checks -> `health.down` (critical when the check is critical) and `health.degraded` (low, dashboard amber). */
export async function scanHealth(now: Date): Promise<void> {
  const results = await runChecks({ record: true, now });
  await reconcile(
    'health.down',
    results.filter((r) => r.status === 'down').map((r) => ({ fingerprint: r.id, title: `${r.label} is down`, body: r.detail ?? '', severity: r.critical ? 'critical' : 'high' })),
    { now },
  );
  await reconcile(
    'health.degraded',
    results.filter((r) => r.status === 'degraded').map((r) => ({ fingerprint: r.id, title: `${r.label} needs attention`, body: r.detail ?? '' })),
    { now },
  );
}

/**
 * Open server-error issues (core observability) -> `error.issue`: one alert per fingerprint, critical on checkout,
 * pay and webhook routes, resolved when the issue is resolved or ignored or stays quiet for 7 days.
 * Repeats above the spike threshold in 10 minutes -> `error.spike`.
 */
export async function scanErrors(now: Date, settings: MonitoringSettings): Promise<void> {
  // Written out in full: drizzle leaves column names unqualified inside a sql`` subquery, and both tables have "id".
  const lastRoute = sql<string | null>`(select e.route from core_error_event e where e.issue_id = "core_error_issue"."id" order by e.created_at desc limit 1)`;
  const issues = await db
    .select({ fingerprint: coreErrorIssue.fingerprint, title: coreErrorIssue.title, count: coreErrorIssue.count, route: lastRoute })
    .from(coreErrorIssue)
    .where(and(eq(coreErrorIssue.status, 'open'), eq(coreErrorIssue.level, 'error'), gt(coreErrorIssue.lastSeen, new Date(now.getTime() - 7 * 24 * 60 * MINUTE))))
    .orderBy(desc(coreErrorIssue.lastSeen))
    .limit(200);
  await reconcile(
    'error.issue',
    issues.map((i) => ({
      fingerprint: i.fingerprint,
      title: `Server error: ${i.title}`.slice(0, 300),
      body: `${i.route ? `Route ${i.route}. ` : ''}${i.count} occurrence(s).`,
      ...(isCriticalRoute(i.route) ? { severity: 'critical' as const } : {}),
    })),
    { now },
  );

  const spikes = await db
    .select({ fingerprint: coreErrorIssue.fingerprint, title: coreErrorIssue.title, n: sql<number>`count(*)::int` })
    .from(coreErrorEvent)
    .innerJoin(coreErrorIssue, eq(coreErrorIssue.id, coreErrorEvent.issueId))
    .where(gt(coreErrorEvent.createdAt, new Date(now.getTime() - 10 * MINUTE)))
    .groupBy(coreErrorIssue.fingerprint, coreErrorIssue.title)
    .having(sql`count(*) > ${settings.errorSpikeThreshold}`);
  await reconcile(
    'error.spike',
    spikes.map((s) => ({ fingerprint: s.fingerprint, title: `Error spike: ${s.title}`.slice(0, 300), body: `${s.n} times in the last 10 minutes.` })),
    { now },
  );
}

async function hasJobSchema(): Promise<boolean> {
  const { rows } = await db.execute<{ t: string | null }>(sql`select to_regclass('pgboss.job')::text as t`);
  return !!rows[0]?.t;
}

/** Dead-letter arrivals (`<queue>.dead` holding jobs) and backlog per queue. Worker heartbeat is a readiness check. */
export async function scanJobs(now: Date, settings: MonitoringSettings): Promise<void> {
  if (!(await hasJobSchema())) return;
  const { rows: dead } = await db.execute<{ name: string; n: number }>(
    sql`select name, count(*)::int as n from pgboss.job where name like '%.dead' and state = 'created' group by name order by name`,
  );
  await reconcile(
    'jobs.dead-letter',
    dead.map((d) => ({ fingerprint: d.name, title: `Failed jobs in ${d.name}`, body: `${d.n} job(s) failed after every retry. Retry or clear them on the Jobs screen.` })),
    { now },
  );
  const { rows: backlog } = await db.execute<{ name: string; n: number }>(
    sql`select name, count(*)::int as n from pgboss.job where state in ('created', 'retry') and name not like '%.dead' group by name having count(*) > ${settings.jobBacklogLimit} order by name`,
  );
  await reconcile(
    'jobs.backlog',
    backlog.map((b) => ({ fingerprint: b.name, title: `Job backlog in ${b.name}`, body: `${b.n} jobs waiting (limit ${settings.jobBacklogLimit}).` })),
    { now },
  );
}

/** Failures this many times in this window raise `integration.failed`; one blip does not page anyone. */
export const INTEGRATION_FAILURES_TO_ALERT = 3;
export const INTEGRATION_WINDOW_MIN = 15;

/** Subscriber for `integration.failed` (emitted by core `integrationCall`). */
export const onIntegrationFailed: EventHandler<'integration.failed'> = async (payload) => {
  const now = new Date();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(coreIntegrationLog)
    .where(
      and(
        eq(coreIntegrationLog.provider, payload.provider),
        eq(coreIntegrationLog.op, payload.operation),
        eq(coreIntegrationLog.status, 'failed'),
        gt(coreIntegrationLog.createdAt, new Date(now.getTime() - INTEGRATION_WINDOW_MIN * MINUTE)),
      ),
    );
  if ((row?.n ?? 0) < INTEGRATION_FAILURES_TO_ALERT) return;
  await alert(
    {
      rule: 'integration.failed',
      fingerprint: `${payload.provider}:${payload.operation}`,
      title: `${payload.provider} ${payload.operation} is failing`,
      body: `${row!.n} failures in ${INTEGRATION_WINDOW_MIN} minutes. Last error: ${payload.error}`.slice(0, 4000),
    },
    { now },
  );
};

/** Resolves `integration.failed` issues whose latest call succeeded. */
export async function scanIntegrations(now: Date): Promise<void> {
  const open = await db
    .select({ fingerprint: monitoringAlert.fingerprint })
    .from(monitoringAlert)
    .where(and(eq(monitoringAlert.ruleKey, 'integration.failed'), ne(monitoringAlert.status, 'resolved')));
  for (const { fingerprint } of open) {
    const [provider, ...rest] = fingerprint.split(':');
    const [latest] = await db
      .select({ status: coreIntegrationLog.status })
      .from(coreIntegrationLog)
      .where(and(eq(coreIntegrationLog.provider, provider!), eq(coreIntegrationLog.op, rest.join(':'))))
      .orderBy(desc(coreIntegrationLog.createdAt), desc(coreIntegrationLog.id))
      .limit(1);
    if (latest?.status === 'ok') await resolveAlert('integration.failed', fingerprint, { now });
  }
}

export function selfCheckUrl(settings: MonitoringSettings): string {
  return settings.selfCheckUrl || new URL('/api/health/live', env.INTERNAL_BASE_URL).toString();
}

/** The worker calls the web process's liveness URL (internal uptime check; an external pinger watches /api/health/ready). */
export async function scanUptime(now: Date, settings: MonitoringSettings): Promise<void> {
  const url = selfCheckUrl(settings);
  const started = performance.now();
  let problem: string | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!res.ok) problem = `HTTP ${res.status}`;
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }
  await recordCheck('uptime.live', !problem, { latencyMs: Math.round(performance.now() - started), detail: problem ? { error: problem } : null, now });
  await reconcile('uptime.live', problem ? [{ fingerprint: 'live', title: 'The site is not answering', body: `${url}: ${problem}` }] : [], { now });
}

/** The minute job. Every part runs even when another fails; failures land in the error log. */
export async function tick(options: { now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date();
  const settings = await monitoringSettings();
  const parts: [string, () => Promise<unknown>][] = [
    ['health', () => scanHealth(now)],
    ['errors', () => scanErrors(now, settings)],
    ['jobs', () => scanJobs(now, settings)],
    ['integrations', () => scanIntegrations(now)],
    ['uptime', () => scanUptime(now, settings)],
    ['repeats', () => sendRepeats({ now })],
  ];
  for (const [name, run] of parts) {
    try {
      await run();
    } catch (err) {
      await captureError(err, { route: `job:monitoring.tick:${name}` });
    }
  }
}

// ---- daily -------------------------------------------------------------------

/** Network lookups of the daily checks, swappable in tests. */
export interface NetLookups {
  certExpiry(host: string): Promise<Date | null>;
  domainExpiry(domain: string): Promise<Date | null>;
  dns(domain: string): Promise<DnsSnapshot>;
}

const listOrEmpty = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);

export const realLookups: NetLookups = {
  certExpiry: (host) =>
    new Promise((resolve, reject) => {
      const socket = connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
        const validTo = socket.getPeerCertificate()?.valid_to;
        socket.end();
        resolve(validTo ? new Date(validTo) : null);
      });
      socket.on('timeout', () => socket.destroy(new Error('TLS timeout')));
      socket.on('error', reject);
    }),
  domainExpiry: async (domain) => {
    const res = await safeFetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: 'application/rdap+json' } }, { timeoutMs: 10_000, maxBytes: 512 * 1024 });
    return res.ok ? rdapExpiry(await res.json()) : null;
  },
  dns: async (domain) => {
    const [a, mx, txt, dmarc] = await Promise.all([
      listOrEmpty(resolve4(domain)),
      listOrEmpty(resolveMx(domain)).then((r) => r.map((m) => m.exchange)),
      listOrEmpty(resolveTxt(domain)).then((r) => r.map((parts) => parts.join(''))),
      listOrEmpty(resolveTxt(`_dmarc.${domain}`)).then((r) => r.map((parts) => parts.join(''))),
    ]);
    return { a, mx, txt, dmarc };
  },
};

export function checkedDomains(settings: MonitoringSettings): string[] {
  const listed = splitList(settings.domains).map((d) => d.toLowerCase().replace(/\.$/, ''));
  if (listed.length) return listed;
  return env.SITE_URL ? [new URL(env.SITE_URL).hostname] : [];
}

/** Registration lives on the apex: www.example.com is registered as example.com. */
export const apexOf = (host: string) => host.replace(/^www\./, '');

export async function scanDomains(now: Date, settings: MonitoringSettings, net: NetLookups = realLookups): Promise<void> {
  const ssl: ActiveCondition[] = [];
  const registration: ActiveCondition[] = [];
  const dns: ActiveCondition[] = [];
  for (const host of checkedDomains(settings)) {
    try {
      const problem = expiryProblem(`Certificate for ${host}`, await net.certExpiry(host), CERT_MIN_DAYS, now);
      if (problem) ssl.push({ fingerprint: host, title: problem });
      await recordCheck(`ssl:${host}`, !problem, { detail: problem ? { problem } : null, now });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ssl.push({ fingerprint: host, title: `Could not read the certificate for ${host}`, body: msg });
      await recordCheck(`ssl:${host}`, false, { detail: { error: msg }, now });
    }

    const apex = apexOf(host);
    if (!registration.some((r) => r.fingerprint === apex)) {
      // Unknown expiry (RDAP down or not offered) is recorded, not alerted.
      const expires = await net.domainExpiry(apex).catch(() => null);
      const problem = expires ? expiryProblem(`Domain ${apex}`, expires, DOMAIN_MIN_DAYS, now) : null;
      if (problem) registration.push({ fingerprint: apex, title: problem });
      await recordCheck(`domain:${apex}`, !problem, { detail: { expires: expires?.toISOString() ?? null, ...(problem ? { problem } : {}) }, now });
    }

    const missing = dnsMissing(await net.dns(host));
    if (missing.length) dns.push({ fingerprint: host, title: `DNS records missing for ${host}: ${missing.join(', ')}` });
    await recordCheck(`dns:${host}`, !missing.length, { detail: missing.length ? { missing } : null, now });
  }
  await reconcile('ssl.expiry', ssl, { now });
  await reconcile('domain.expiry', registration, { now });
  await reconcile('dns.records', dns, { now });
}

/** The nightly backup script records `backup.nightly` (see README); stale or missing means no restorable copy. */
export const BACKUP_CHECK = 'backup.nightly';

export async function scanBackup(now: Date, settings: MonitoringSettings): Promise<void> {
  const [last] = await db
    .select({ at: monitoringCheckResult.createdAt })
    .from(monitoringCheckResult)
    .where(and(eq(monitoringCheckResult.check, BACKUP_CHECK), eq(monitoringCheckResult.ok, true)))
    .orderBy(desc(monitoringCheckResult.createdAt))
    .limit(1);
  const stale = !last || now.getTime() - last.at.getTime() > settings.backupMaxAgeHours * 60 * MINUTE;
  await reconcile(
    'backup.stale',
    stale ? [{ fingerprint: 'nightly', title: last ? `Last backup is older than ${settings.backupMaxAgeHours} hours` : 'No successful backup recorded', body: last ? `Last success ${last.at.toISOString()}.` : '' }] : [],
    { now },
  );
}

export const DB_CONNECTION_LIMIT_RATIO = 0.8;

/** Size and connection use, recorded daily (growth shows in the check log); alert at 80% of max_connections. */
export async function scanDatabase(now: Date): Promise<void> {
  const { rows } = await db.execute<{ size: string; connections: number; max: number }>(sql`
    select pg_database_size(current_database())::text as size,
      (select count(*)::int from pg_stat_activity where datname = current_database()) as connections,
      current_setting('max_connections')::int as max`);
  const r = rows[0]!;
  const ratio = r.connections / r.max;
  await recordCheck('db.stats', ratio < DB_CONNECTION_LIMIT_RATIO, { detail: { sizeBytes: Number(r.size), connections: r.connections, maxConnections: r.max }, now });
  await reconcile('db.connections', ratio >= DB_CONNECTION_LIMIT_RATIO ? [{ fingerprint: 'connections', title: `Database connections at ${Math.round(ratio * 100)}%`, body: `${r.connections} of ${r.max}.` }] : [], { now });
}

/** Retention: check results 30 days, resolved alerts 90 days. */
export async function pruneMonitoring(now: Date): Promise<void> {
  await db.delete(monitoringCheckResult).where(lt(monitoringCheckResult.createdAt, new Date(now.getTime() - 30 * 24 * 60 * MINUTE)));
  await db.delete(monitoringAlert).where(and(eq(monitoringAlert.status, 'resolved'), lt(monitoringAlert.resolvedAt, new Date(now.getTime() - 90 * 24 * 60 * MINUTE))));
}

export async function daily(options: { now?: Date; net?: NetLookups } = {}): Promise<void> {
  const now = options.now ?? new Date();
  const settings = await monitoringSettings();
  const parts: [string, () => Promise<unknown>][] = [
    ['domains', () => scanDomains(now, settings, options.net)],
    ['backup', () => scanBackup(now, settings)],
    ['database', () => scanDatabase(now)],
    ['prune', () => pruneMonitoring(now)],
  ];
  for (const [name, run] of parts) {
    try {
      await run();
    } catch (err) {
      await captureError(err, { route: `job:monitoring.daily:${name}` });
    }
  }
}
