import { Badge, Button, EmptyState, Sparkline, Stat, TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import Link from 'next/link';
import { bellCounts } from '../server/alerts';
import { getRuntime } from '../server/runtime';
import { checkHistory, heartbeats, integrationCards, latestCheckResults, listQueues } from '../server/views';
import { runChecksAction } from './actions';
import { ago, ist, pct } from './format';
import { HealthTabs } from './HealthTabs';

const detailText = (detail: unknown): string => {
  if (!detail || typeof detail !== 'object') return '';
  const d = detail as Record<string, unknown>;
  const text = d.detail ?? d.error ?? d.problem ?? (Array.isArray(d.missing) ? `missing ${d.missing.join(', ')}` : '');
  return typeof text === 'string' ? text : JSON.stringify(text);
};

/** System health: checks, uptime, open alerts, integration cards, workers. */
export async function HealthOverviewPage({ now = new Date() }: { now?: Date } = {}) {
  const [checks, uptime, bell, cards, workers, queues] = await Promise.all([latestCheckResults(), checkHistory('uptime.live', { now }), bellCounts(), integrationCards({ now }), heartbeats(), listQueues()]);
  const failing = checks.filter((c) => !c.ok);
  const openAlerts = bell.open.critical + bell.open.high + bell.open.low;
  const failedJobs = queues.reduce((n, q) => n + q.failed + q.dead, 0);
  const uptimePoints = uptime.hourly.filter((v): v is number => v !== null).map((v) => v * 100);
  const hasSeo = getRuntime().registry?.has('seo') ?? false;

  return (
    <div className="flex flex-col gap-6">
      <HealthTabs active="/admin/health" title="Health" />

      <section aria-label="Summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Checks"
          value={checks.length === 0 ? 'Not run yet' : failing.length ? `${failing.length} failing` : 'All passing'}
          trend={failing.length ? 'down' : 'flat'}
          delta={checks.length ? `${checks.length} checks recorded` : 'The worker records checks every minute'}
        />
        <Stat
          label="Open alerts"
          value={openAlerts}
          trend={bell.open.critical ? 'down' : 'flat'}
          delta={`${bell.open.critical} critical, ${bell.open.high} high, ${bell.open.low} low, ${bell.acked} acked`}
        />
        <Stat label="Uptime, last 24 h" value={pct(uptime.okRatio)} chart={uptimePoints.length > 1 ? <Sparkline values={uptimePoints} label={`Hourly uptime, last 24 hours, ${pct(uptime.okRatio)} overall`} /> : undefined} />
        <Stat label="Failed jobs" value={failedJobs} trend={failedJobs ? 'down' : 'flat'} delta={<Link href="/admin/health/jobs" className="underline">Open the job queue</Link>} />
      </section>

      <section aria-labelledby="checks-h" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="checks-h" className="text-lg font-semibold text-text">
            Checks
          </h2>
          <form action={runChecksAction}>
            <Button type="submit" variant="subtle" size="sm" data-cta="health-run-checks">
              Run checks now
            </Button>
          </form>
        </div>
        {checks.length === 0 ? (
          <EmptyState title="No check results yet" body="Results appear once the worker runs (every minute) or after Run checks now." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Check</Th>
                <Th>Status</Th>
                <Th className="text-right">Latency</Th>
                <Th>Detail</Th>
                <Th>When</Th>
              </tr>
            </THead>
            <TBody>
              {checks.map((c) => (
                <Tr key={c.check}>
                  <Td className="font-mono text-xs">{c.check}</Td>
                  <Td>{c.ok ? <Badge tone="success">ok</Badge> : <Badge tone="danger">failing</Badge>}</Td>
                  <Td className="text-right tabular-nums">{c.latencyMs == null ? '' : `${c.latencyMs} ms`}</Td>
                  <Td className="max-w-md truncate text-muted">{detailText(c.detail)}</Td>
                  <Td title={ist(c.createdAt)}>{ago(c.createdAt, now)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="integrations-h" className="flex flex-col gap-3">
        <h2 id="integrations-h" className="text-lg font-semibold text-text">
          Integrations
        </h2>
        {cards.length === 0 ? (
          <EmptyState title="No integration calls yet" body="Every call to an outside service (payments, email, WhatsApp, ERP) shows up here." />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <li key={c.provider} className="flex flex-col gap-2 rounded-md bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/admin/health/logs?type=integration&provider=${encodeURIComponent(c.provider)}`} className="font-semibold text-text hover:underline">
                    {c.provider}
                  </Link>
                  {c.mode === 'not_configured' ? (
                    <Badge tone="outline">not configured</Badge>
                  ) : c.errorRate24h && c.errorRate24h > 0.2 ? (
                    <Badge tone="danger">failing</Badge>
                  ) : c.failed24h ? (
                    <Badge tone="warning">errors</Badge>
                  ) : (
                    <Badge tone="success">ok</Badge>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">Calls 24 h</dt>
                  <dd className="tabular-nums">{c.calls24h}</dd>
                  <dt className="text-muted">Error rate</dt>
                  <dd className="tabular-nums">{pct(c.errorRate24h)}</dd>
                  <dt className="text-muted">Avg latency</dt>
                  <dd className="tabular-nums">{c.avgLatencyMs == null ? 'n/a' : `${c.avgLatencyMs} ms`}</dd>
                  <dt className="text-muted">Last ok</dt>
                  <dd>{ago(c.lastOkAt, now)}</dd>
                </dl>
                {c.lastError ? <p className="line-clamp-2 text-xs text-danger">{c.lastError}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="workers-h" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 id="workers-h" className="text-lg font-semibold text-text">
            Workers
          </h2>
          {workers.length === 0 ? (
            <EmptyState title="No worker has started" body="Start the worker process; jobs, alerts and digests depend on it." />
          ) : (
            <ul className="flex flex-col gap-2">
              {workers.map((w) => (
                <li key={w.worker} className="flex items-center justify-between rounded-md bg-surface px-4 py-3 shadow-card">
                  <span className="font-mono text-xs">{w.worker}</span>
                  <span className="text-sm text-muted" title={ist(w.lastSeen)}>
                    {ago(w.lastSeen, now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text">Not found pages</h2>
          {hasSeo ? (
            <p className="text-sm text-muted">
              The 404 log and one-click redirects live in{' '}
              <Link href="/admin/seo" className="underline">
                SEO
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm text-muted">The 404 log needs the SEO module, which is not enabled in this store.</p>
          )}
        </div>
      </section>
    </div>
  );
}
