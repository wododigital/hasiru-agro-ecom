import { Badge } from '@ecomkit/ui';
import Link from 'next/link';
import { bellCounts, listAlerts } from '../server/alerts';
import { severityTone } from './format';

/** Dashboard widget: open alert issues, most recent first. */
export async function AlertsWidget() {
  const [bell, { rows }] = await Promise.all([bellCounts(), listAlerts({ status: 'unresolved', pageSize: 5 })]);
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No open alerts.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-sm">
              <Badge tone={severityTone[a.severity]}>{a.severity}</Badge>
              <span className="line-clamp-2 text-text">{a.title}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/admin/health/alerts" className="text-sm font-semibold text-primary hover:underline">
        {bell.total ? `All ${bell.total} open alerts` : 'Alerts'}
      </Link>
    </div>
  );
}
