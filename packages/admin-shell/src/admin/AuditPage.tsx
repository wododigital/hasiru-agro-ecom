import type { AuditRow } from '@ecomkit/core/audit';
import { Badge, Button, DataTable, Input, buttonVariants, type Column } from '@ecomkit/ui';
import { parseTableParams } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { Suspense } from 'react';
import { auditChanges } from '../domain';
import { requireAdmin } from '../server/access';
import { loadAudit } from '../server/audit';
import { NoAccess, PageHeader, PageSkeleton } from './PageHeader';

const when = (d: Date) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(d);
const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
};
const query = (p: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();
  return q ? `?${q}` : '';
};

const columns: Column<AuditRow>[] = [
  { id: 'at', header: 'When', cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.createdAt)}</span> },
  {
    id: 'actor',
    header: 'By',
    cell: (r) => (
      <span className="flex flex-col">
        <span>{r.actorType}</span>
        {r.actorId ? <span className="font-mono text-xs text-muted">{r.actorId.slice(0, 8)}</span> : null}
      </span>
    ),
  },
  { id: 'action', header: 'Action', cell: (r) => <Badge tone="neutral">{r.action}</Badge> },
  {
    id: 'entity',
    header: 'Record',
    cell: (r) => (
      <Link href={`/admin/audit${query({ entity: r.entity, entityId: r.entityId })}`} className="hover:underline">
        {r.entity}
        <span className="block font-mono text-xs text-muted">{r.entityId}</span>
      </Link>
    ),
  },
  {
    id: 'changes',
    header: 'Changes',
    cell: (r) => {
      const changes = auditChanges(r.before, r.after);
      if (!changes.length) return <span className="text-muted">None recorded</span>;
      return (
        <ul className="flex flex-col gap-0.5 text-xs">
          {changes.slice(0, 6).map((c) => (
            <li key={c.key}>
              <span className="font-semibold">{c.key}</span>
              {`: ${short(c.before)} → ${short(c.after)}`}
            </li>
          ))}
          {changes.length > 6 ? <li className="text-muted">{`and ${changes.length - 6} more`}</li> : null}
        </ul>
      );
    },
  },
];

/**
 * /admin/audit: the append-only history (settings changes, role changes, price edits, refunds...).
 * Filter by record type and id; newest first; "Older" pages by time.
 */
export function AuditPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuditContent {...props} />
    </Suspense>
  );
}

async function AuditContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdmin('audit.read');
  if (access.state === 'forbidden') return <NoAccess title="Audit log" />;
  const { rows, older, params } = await loadAudit(await searchParams);
  return (
    <>
      <PageHeader title="Audit log" description="Every change staff and the system made. Secrets are never recorded, only that they changed." />
      <form method="get" action="/admin/audit" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Record type
          <Input name="entity" defaultValue={params.entity ?? ''} placeholder="settings" className="py-2" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Record id
          <Input name="entityId" defaultValue={params.entityId ?? ''} className="py-2" />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
        {params.entity || params.entityId || params.before ? (
          <Link href="/admin/audit" className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
            Clear
          </Link>
        ) : null}
      </form>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={parseTableParams({})}
        total={rows.length}
        pageSize={Math.max(rows.length, 1)}
        basePath="/admin/audit"
        search={false}
      />
      {older ? (
        <Link href={`/admin/audit${query({ entity: params.entity, entityId: params.entityId, before: older })}`} className={buttonVariants({ size: 'sm', variant: 'outline' })} data-cta="audit-older">
          Older entries
        </Link>
      ) : null}
    </>
  );
}
