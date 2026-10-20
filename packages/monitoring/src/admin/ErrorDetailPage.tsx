import { dynamicRequest } from '../server/request';
import { Badge } from '@ecomkit/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getIssue } from '../server/views';
import { IssueStatusButtons } from './ErrorsPage';
import { ago, ist } from './format';
import { HealthTabs } from './HealthTabs';

/** One error issue with its latest events (stack, route, release). */
export async function ErrorDetailPage({ id, now: nowOverride }: { id: string; now?: Date }) {
  await dynamicRequest();
  const now = nowOverride ?? new Date();
  const found = await getIssue(id);
  if (!found) notFound();
  const { issue, events } = found;
  return (
    <div className="flex flex-col gap-6">
      <HealthTabs active="/admin/health/errors" title="Error" />
      <Link href="/admin/health/errors" className="text-sm text-muted hover:underline">
        Back to errors
      </Link>
      <section className="flex flex-col gap-2 rounded-md bg-surface p-4 shadow-card">
        <h2 className="text-lg font-semibold break-words text-text">{issue.title}</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone={issue.status === 'open' ? 'danger' : 'neutral'}>{issue.status}</Badge>
          <span>{issue.count} events</span>
          <span>first {ist(issue.firstSeen)}</span>
          <span>last {ago(issue.lastSeen, now)}</span>
          <span className="font-mono text-xs">{issue.fingerprint}</span>
        </p>
        <IssueStatusButtons issue={issue} />
      </section>
      <section aria-labelledby="events-h" className="flex flex-col gap-3">
        <h2 id="events-h" className="text-lg font-semibold text-text">
          Latest events
        </h2>
        {events.map((e) => (
          <article key={e.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
            <p className="flex flex-wrap gap-3 text-xs text-muted">
              <span>{ist(e.createdAt)}</span>
              {e.method ? <span>{e.method}</span> : null}
              {e.route ? <span className="font-mono">{e.route}</span> : null}
              {e.url ? <span className="font-mono">{e.url}</span> : null}
              {e.release ? <span className="font-mono">release {e.release.slice(0, 8)}</span> : null}
              {e.requestId ? <span className="font-mono">request {e.requestId}</span> : null}
            </p>
            <p className="text-sm break-words text-text">{e.message}</p>
            {e.stack ? <pre className="max-h-64 overflow-auto rounded-sm bg-surface-2 p-3 text-xs">{e.stack}</pre> : null}
          </article>
        ))}
      </section>
    </div>
  );
}
