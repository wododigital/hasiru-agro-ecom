// Admin moderation queue (admin copy is English-only, exempt from messages).
import { Badge, Button, DataTable, Textarea, type Column } from '@ecomkit/ui';
import { parseTableParams, type SearchParamsInput } from '@ecomkit/ui/domain';
import { REVIEW_STATUSES, type ReviewStatus } from '../domain';
import { listForModeration, type ReviewWithMedia } from '../server';
import { bulkModerateAction, moderateAction } from './actions';

const PAGE = 25;
const when = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export async function ReviewsModerationPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = parseTableParams(searchParams, { filters: { status: REVIEW_STATUSES } });
  const status = params.filters.status as ReviewStatus | undefined;
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
        <div className="relative z-10 flex min-w-56 flex-col gap-2">
          <Textarea name={`reply:${r.id}`} maxLength={1000} defaultValue={r.adminReply ?? ''} aria-label="Public reply (optional)" className="min-h-16 text-sm" />
          <div className="flex gap-2">
            <Button type="submit" formAction={moderateAction} name="decision" value={`approved:${r.id}`} size="sm">
              Approve
            </Button>
            <Button type="submit" formAction={moderateAction} name="decision" value={`rejected:${r.id}`} size="sm" variant="subtle">
              Reject
            </Button>
          </div>
        </div>
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
        params={params}
        total={total}
        pageSize={PAGE}
        basePath="/admin/reviews"
        search={false}
        views={REVIEW_STATUSES.map((s) => ({ id: s, label: s.charAt(0).toUpperCase() + s.slice(1), filters: { status: s } }))}
        bulkActions={[
          { label: 'Approve', action: bulkModerateAction.bind(null, 'approved') },
          { label: 'Reject', action: bulkModerateAction.bind(null, 'rejected'), tone: 'danger' },
        ]}
      />
    </div>
  );
}
