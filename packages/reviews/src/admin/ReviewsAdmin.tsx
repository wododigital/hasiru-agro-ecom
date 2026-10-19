// Admin moderation queue (admin copy is English-only, exempt from messages).
import { Badge, Button, DataTable, Textarea, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import { REVIEW_STATUSES, type ReviewStatus } from '../domain';
import { listForModeration, type ReviewWithMedia } from '../server';
import { moderateAction } from './actions';

const PAGE = 25;
const when = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export async function ReviewsModerationPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = parseTableParams(searchParams, { filters: { status: REVIEW_STATUSES } });
  const status = (params.filters.status ?? 'pending') as ReviewStatus;
  const { rows, total } = await listForModeration({ status, page: params.page, pageSize: PAGE });
  const columns: Column<ReviewWithMedia>[] = [
    { id: 'rating', header: 'Rating', cell: (r) => `${r.rating} / 5` },
    {
      id: 'review',
      header: 'Review',
      cell: (r) => (
        <div className="flex max-w-xl flex-col gap-1">
          {r.title ? <span className="font-semibold">{r.title}</span> : null}
          <span className="whitespace-pre-wrap">{r.body}</span>
          <span className="text-xs text-muted">
            {[r.authorName, r.districtText, `product ${r.productId.slice(0, 8)}`, r.mediaIds.length ? `${r.mediaIds.length} photos` : null].filter(Boolean).join(' · ')}
          </span>
        </div>
      ),
    },
    {
      id: 'flags',
      header: 'Flags',
      cell: (r) => (
        <span className="flex flex-col gap-1">
          {r.isVerifiedBuyer ? <Badge tone="success">Verified buyer</Badge> : null}
          {r.isSample ? <Badge tone="warning">Sample</Badge> : null}
        </span>
      ),
    },
    { id: 'when', header: 'Received', cell: (r) => when(r.createdAt) },
    {
      id: 'actions',
      header: 'Decision',
      cell: (r) => (
        <form action={moderateAction} className="flex min-w-56 flex-col gap-2">
          <input type="hidden" name="id" value={r.id} />
          <Textarea name="reply" maxLength={1000} defaultValue={r.adminReply ?? ''} aria-label="Public reply (optional)" className="min-h-16 text-sm" />
          <div className="flex gap-2">
            <Button type="submit" name="decision" value="approved" size="sm">
              Approve
            </Button>
            <Button type="submit" name="decision" value="rejected" size="sm" variant="subtle">
              Reject
            </Button>
          </div>
        </form>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Reviews</h1>
      <p className="text-sm text-muted">Ratings show on products only from 3 approved reviews. Sample rows are never counted.</p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        params={{ ...params, filters: { status } }}
        total={total}
        pageSize={PAGE}
        basePath="/admin/reviews"
        search={false}
        filters={[{ key: 'status', label: 'Status', options: REVIEW_STATUSES.map((s) => ({ value: s, label: s })) }]}
      />
    </div>
  );
}
