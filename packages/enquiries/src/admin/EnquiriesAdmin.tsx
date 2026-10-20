// Admin pages for the enquiry pipeline (admin copy is English-only, exempt from messages).
import { can, getViewer } from '@ecomkit/core/auth-context';
import { Badge, Button, Card, DataTable, DetailFrame, Select, Stat, Textarea, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import Link from 'next/link';
import { ENQUIRY_STATUSES, QUIET_AFTER_DAYS, type EnquiryStatus } from '../domain';
import { getEnquiry, lastEnquiry, listEnquiries, pipeline, type EnquiryListRow } from '../server';
import { addNoteAction, assignAction, bulkAction, transitionAction } from './actions';

const PAGE = 25;
const when = (d: Date | null) => (d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '-');
const label = (s: string) => s.replace(/_/g, ' ');

function StatusBadge({ row }: { row: Pick<EnquiryListRow, 'status' | 'stale'> }) {
  const closed = row.status === 'closed_won' || row.status === 'closed_lost';
  return (
    <span className="inline-flex gap-1">
      <Badge tone={row.status === 'closed_won' ? 'success' : closed ? 'outline' : 'neutral'}>{label(row.status)}</Badge>
      {row.stale ? <Badge tone="warning">Stale</Badge> : null}
    </span>
  );
}

export async function EnquiriesPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = parseTableParams(searchParams, { filters: { status: ENQUIRY_STATUSES, view: ['list', 'board'] } });
  const view = params.filters.view ?? 'list';
  const toggle = (
    <nav className="flex gap-3 text-sm">
      <Link href="/admin/enquiries" aria-current={view === 'list' ? 'page' : undefined} className="underline">
        List
      </Link>
      <Link href="/admin/enquiries?view=board" aria-current={view === 'board' ? 'page' : undefined} className="underline">
        Board
      </Link>
    </nav>
  );
  if (view === 'board') {
    const board = await pipeline();
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Enquiries</h1>
        {toggle}
        <div className="flex gap-3 overflow-x-auto pb-2">
          {ENQUIRY_STATUSES.map((s) => (
            <section key={s} className="flex w-64 shrink-0 flex-col gap-2 rounded-md bg-surface-2 p-2">
              <h2 className="px-1 text-sm font-semibold capitalize">
                {label(s)} ({board[s].length})
              </h2>
              {board[s].map((e) => (
                <Link key={e.id} href={`/admin/enquiries/${e.id}`} className="flex flex-col gap-1 rounded-sm bg-surface p-2 text-sm shadow-card">
                  <span className="font-medium">{e.name}</span>
                  <span className="text-muted">{[e.acres ? `${e.acres} acres` : null, e.locationText].filter(Boolean).join(', ')}</span>
                  {e.stale ? <Badge tone="warning">Stale</Badge> : null}
                </Link>
              ))}
            </section>
          ))}
        </div>
      </div>
    );
  }
  const { rows, total } = await listEnquiries({ q: params.q, status: params.filters.status as EnquiryStatus | undefined, page: params.page, pageSize: PAGE });
  const columns: Column<EnquiryListRow>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.name },
    { id: 'phone', header: 'Phone', cell: (r) => r.phoneE164 },
    { id: 'kind', header: 'Kind', cell: (r) => label(r.kind) },
    { id: 'acres', header: 'Acres', align: 'right', cell: (r) => r.acres ?? '-' },
    { id: 'location', header: 'Location', cell: (r) => r.locationText ?? '-' },
    { id: 'status', header: 'Status', cell: (r) => <StatusBadge row={r} /> },
    { id: 'created', header: 'Received', cell: (r) => when(r.createdAt) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Enquiries</h1>
      {toggle}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={params}
        total={total}
        pageSize={PAGE}
        basePath="/admin/enquiries"
        rowHref={(r) => `/admin/enquiries/${r.id}`}
        views={[
          { id: 'new', label: 'New', filters: { status: 'new' } },
          { id: 'contacted', label: 'Contacted', filters: { status: 'contacted' } },
          { id: 'quotation', label: 'Quotation', filters: { status: 'quotation' } },
          { id: 'won', label: 'Won', filters: { status: 'closed_won' } },
        ]}
        filters={[{ key: 'status', label: 'Status', options: ENQUIRY_STATUSES.map((s) => ({ value: s, label: label(s) })) }]}
        bulkActions={
          can(await getViewer(), 'enquiries.write')
            ? [
                { label: 'Assign to me', action: bulkAction.bind(null, 'assign_me') },
                { label: 'Mark contacted', action: bulkAction.bind(null, 'contacted') },
                { label: 'Close as lost', action: bulkAction.bind(null, 'closed_lost'), tone: 'danger' as const },
              ]
            : undefined
        }
      />
    </div>
  );
}

export async function EnquiryDetailPage({ id }: { id: string }) {
  const { enquiry: e, notes, attachments } = await getEnquiry(id);
  const canWrite = can(await getViewer(), 'enquiries.write');
  const facts: [string, string][] = [
    ['Phone', e.phoneE164],
    ['Email', e.email ?? '-'],
    ['Customer type', e.customerType ?? '-'],
    ['Acres', e.acres == null ? '-' : String(e.acres)],
    ['Location', e.locationText ?? '-'],
    ['Timeline', e.timeline ?? '-'],
    ['Requirement', e.requirement ?? '-'],
    ['Their notes', e.customerNotes ?? '-'],
    ['Came from', [e.sourcePath, ...Object.entries(e.utm).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join(' ') || '-'],
    ['Lead', e.leadId ?? 'Not linked'],
    ['Assigned', e.assignedTo ?? 'Nobody'],
    ['Received', when(e.createdAt)],
  ];
  return (
    <DetailFrame
      title={e.name}
      backHref="/admin/enquiries"
      backLabel="Enquiries"
      meta={`Received ${when(e.createdAt)}`}
      badges={<StatusBadge row={e} />}
      primary={
        canWrite ? (
        <form action={assignAction} className="flex gap-2">
          <input type="hidden" name="id" value={e.id} />
          <Button type="submit" variant="primary" size="sm">
            Assign to me
          </Button>
        </form>
        ) : null
      }
      more={
        canWrite && e.assignedTo ? (
          <form action={assignAction}>
            <input type="hidden" name="id" value={e.id} />
            <button type="submit" name="clear" value="1" className="w-full text-left">
              Unassign
            </button>
          </form>
        ) : undefined
      }
      aside={
        <>
          <Card title="Status">
            <form action={transitionAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={e.id} />
              <Select name="status" defaultValue={e.status} aria-label="Status">
                {ENQUIRY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="subtle" size="sm">
                Move
              </Button>
            </form>
          </Card>
          {attachments.length ? (
            <Card title="Attachments">
              <ul className="flex flex-col gap-1 text-sm">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <a className="text-primary underline" href={`/api/admin/enquiries/attachments/${a.id}`}>
                      {a.fileName}
                    </a>{' '}
                    <span className="text-muted">({Math.ceil(a.sizeBytes / 1024)} KB)</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      }
    >
      <Card title="Details">
        <dl className="grid grid-cols-[10rem_1fr] gap-2 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="Remarks">
        <form action={addNoteAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={e.id} />
          <Textarea name="body" required maxLength={4000} aria-label="New remark" />
          <Button type="submit" size="sm" className="self-start">
            Add remark
          </Button>
        </form>
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-sm bg-surface-2 p-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-muted">{when(n.createdAt)}</p>
            </li>
          ))}
        </ul>
      </Card>
    </DetailFrame>
  );
}

/** Dashboard tile: "last enquiry N days ago", amber after QUIET_AFTER_DAYS; links to the list. */
export async function EnquiryStalenessWidget() {
  const s = await lastEnquiry();
  return (
    <Link href="/admin/enquiries?status=new">
      <Stat
        label="Last enquiry"
        value={s.days == null ? 'None yet' : s.days === 0 ? 'Today' : `${s.days} days ago`}
        delta={`${s.staleOpen} open and untouched${s.level === 'amber' ? `, quiet for over ${QUIET_AFTER_DAYS} days` : ''}`}
        trend={s.level === 'amber' ? 'down' : 'flat'}
      />
    </Link>
  );
}
