import { Badge, Button, FormField, Input, Select, Textarea } from '@ecomkit/ui';
import Link from 'next/link';
import { PHOTO_TYPES } from '../domain';
import { reviewsMessages, type ReviewOutcome, type ReviewsMessages } from '../messages';
import type { ReviewRow } from '../server';
import { deleteReviewAction, updateReviewAction } from './actions';

export interface AccountReviewsProps {
  reviews: readonly (ReviewRow & { productName: string | null; productHref: string | null })[];
  /** Product to review (from ?product=), with its name when the catalog knows it. */
  writeFor: { productId: string; name: string | null } | null;
  editing: ReviewRow | null;
  outcome: string | undefined;
  photosEnabled: boolean;
  messages?: ReviewsMessages;
}

function Fields({ m, review }: { m: ReviewsMessages['account']; review: ReviewRow | null }) {
  return (
    <>
      <FormField id="review-rating" label={m.rating} required>
        {(p) => (
          <Select {...p} name="rating" required defaultValue={review?.rating ?? 5}>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {m.ratingOption(n)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField id="review-title" label={m.reviewTitle}>
        {(p) => <Input {...p} name="title" maxLength={120} defaultValue={review?.title ?? ''} />}
      </FormField>
      <FormField id="review-body" label={m.body} help={m.bodyHelp} required>
        {(p) => <Textarea {...p} name="body" required minLength={10} maxLength={2000} defaultValue={review?.body ?? ''} />}
      </FormField>
      <FormField id="review-district" label={m.district}>
        {(p) => <Input {...p} name="districtText" maxLength={80} autoComplete="address-level2" defaultValue={review?.districtText ?? ''} />}
      </FormField>
    </>
  );
}

/** /account/reviews: the customer's reviews, the write form (?product=) and the edit form (?edit=). Works without JS. */
export function AccountReviews({ reviews, writeFor, editing, outcome, photosEnabled, messages = reviewsMessages }: AccountReviewsProps) {
  const m = messages.account;
  const outcomeText = outcome && outcome in messages.outcome ? messages.outcome[outcome as ReviewOutcome] : null;
  const good = outcome === 'sent' || outcome === 'saved' || outcome === 'deleted';
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl text-primary">{m.title}</h1>
        <p className="text-muted">{m.intro}</p>
      </header>
      {outcomeText ? (
        <p role={good ? 'status' : 'alert'} className={`rounded-md px-3 py-2 text-sm ${good ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger'}`}>
          {outcomeText}
        </p>
      ) : null}

      {editing ? (
        <form action={updateReviewAction} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-lg font-semibold text-primary">{m.editTitle}</h2>
          <input type="hidden" name="id" value={editing.id} />
          <Fields m={m} review={editing} />
          <Button type="submit" data-cta="account-review-save" className="self-start">
            {m.save}
          </Button>
        </form>
      ) : writeFor ? (
        <form method="post" action="/api/reviews" encType="multipart/form-data" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-lg font-semibold text-primary">{m.writeTitle}</h2>
          {writeFor.name ? (
            <p className="text-sm">
              {m.product}
              {': '}
              <span className="font-semibold">{writeFor.name}</span>
            </p>
          ) : null}
          <input type="hidden" name="productId" value={writeFor.productId} />
          <Fields m={m} review={null} />
          {photosEnabled ? (
            <FormField id="review-photos" label={m.photos} help={m.photosHelp}>
              {(p) => <Input {...p} name="photos" type="file" multiple accept={PHOTO_TYPES.join(',')} />}
            </FormField>
          ) : null}
          <Button type="submit" data-cta="account-review-submit" className="self-start">
            {m.submit}
          </Button>
        </form>
      ) : null}

      {reviews.length === 0 ? (
        <p className="text-muted">{m.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                {r.productHref ? (
                  <Link href={r.productHref} className="font-semibold text-primary underline">
                    {r.productName}
                  </Link>
                ) : null}
                <Badge tone={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'neutral'}>{m.status[r.status]}</Badge>
              </div>
              <p className="text-sm">{r.title ? `${r.title}: ${r.body}` : r.body}</p>
              <div className="flex gap-3">
                <Link href={`/account/reviews?edit=${r.id}`} className="text-sm text-primary underline" data-cta="account-review-edit">
                  {m.edit}
                </Link>
                <form action={deleteReviewAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="text-sm text-danger underline" data-cta="account-review-delete">
                    {m.delete}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
