import { dynamicRequest } from '../server/request';
import { can, getViewer } from '@ecomkit/core/auth-context';
import { Badge, Button, EmptyState, TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import { listFailedJobs, listQueues } from '../server/views';
import { retryJobAction } from './actions';
import { ago, ist } from './format';
import { HealthTabs } from './HealthTabs';

/** Queue counts and failed / dead-lettered jobs with Retry. */
export async function JobsPage({ now: nowOverride }: { now?: Date } = {}) {
  await dynamicRequest();
  const now = nowOverride ?? new Date();
  const [queues, failed, viewer] = await Promise.all([listQueues(), listFailedJobs(), getViewer()]);
  const canRetry = can(viewer, 'jobs.retry');
  return (
    <div className="flex flex-col gap-6">
      <HealthTabs active="/admin/health/jobs" title="Jobs" />
      <section aria-labelledby="queues-h" className="flex flex-col gap-3">
        <h2 id="queues-h" className="text-lg font-semibold text-text">
          Queues
        </h2>
        {queues.length === 0 ? (
          <EmptyState title="No jobs yet" body="Queues appear once the worker has run." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Queue</Th>
                <Th className="text-right">Waiting</Th>
                <Th className="text-right">Running</Th>
                <Th className="text-right">Failed</Th>
                <Th className="text-right">Dead letter</Th>
              </tr>
            </THead>
            <TBody>
              {queues.map((q) => (
                <Tr key={q.name}>
                  <Td className="font-mono text-xs">{q.name}</Td>
                  <Td className="text-right tabular-nums">{q.waiting}</Td>
                  <Td className="text-right tabular-nums">{q.active}</Td>
                  <Td className="text-right tabular-nums">{q.failed ? <Badge tone="warning">{q.failed}</Badge> : 0}</Td>
                  <Td className="text-right tabular-nums">{q.dead ? <Badge tone="danger">{q.dead}</Badge> : 0}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
      <section aria-labelledby="failed-h" className="flex flex-col gap-3">
        <h2 id="failed-h" className="text-lg font-semibold text-text">
          Failed jobs
        </h2>
        {failed.length === 0 ? (
          <EmptyState title="No failed jobs" />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Queue</Th>
                <Th>State</Th>
                <Th>Error</Th>
                <Th>Tries</Th>
                <Th>When</Th>
                <Th>
                  <span className="sr-only">Retry</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {failed.map((j) => (
                <Tr key={j.id}>
                  <Td className="font-mono text-xs">{j.queue}</Td>
                  <Td>{j.queue.endsWith('.dead') ? <Badge tone="danger">dead letter</Badge> : <Badge tone="warning">{j.state}</Badge>}</Td>
                  <Td className="max-w-md truncate text-xs text-muted">{j.error ?? ''}</Td>
                  <Td className="tabular-nums">{j.retryCount}</Td>
                  <Td title={ist(j.createdOn)}>{ago(j.completedOn ?? j.createdOn, now)}</Td>
                  <Td>
                    {canRetry ? (
                      <form action={retryJobAction}>
                        <input type="hidden" name="queue" value={j.queue} />
                        <input type="hidden" name="id" value={j.id} />
                        <Button type="submit" size="sm" variant="subtle" data-cta="job-retry">
                          Retry
                        </Button>
                      </form>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
