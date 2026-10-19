import { tags } from '@ecomkit/core/cache-tags';
import { RATING_MIN_REVIEWS, type ImageRef, type PdpSectionProps } from '@ecomkit/core/contracts';
import { Badge, ImageWithFallback, Rating } from '@ecomkit/ui';
import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';
import { reviewsMessages, type ReviewsMessages } from '../messages';
import { aggregate, getReviewPorts, listApproved } from '../server';

async function load(productId: string) {
  'use cache';
  cacheTag(tags.reviews(productId));
  cacheLife('hours');
  const [agg, list] = await Promise.all([aggregate(productId), listApproved(productId, { pageSize: 10 })]);
  const ref = getReviewPorts().images?.ref;
  const photos: Record<string, ImageRef[]> = {};
  if (ref) {
    for (const r of list) photos[r.id] = (await Promise.all(r.mediaIds.map((id) => ref(id)))).filter((x): x is ImageRef => x !== null);
  }
  return { agg, list, photos };
}

/** PDP section (`#reviews`): rating summary (stars from 3 approved reviews, else "New"), the newest approved reviews, and a link to write one. */
export async function ReviewsSection({ productId, messages = reviewsMessages }: PdpSectionProps & { messages?: ReviewsMessages }) {
  const m = messages.section;
  const { agg, list, photos } = await load(productId);
  return (
    <section id="reviews" aria-labelledby="reviews-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="reviews-title" className="font-display text-2xl text-primary">
          {m.title}
        </h2>
        <Rating average={agg.average} count={agg.count} />
        {agg.count ? <span className="text-sm text-muted">{m.countLabel(agg.count)}</span> : null}
        <Link href={`/account/reviews?product=${productId}`} className="ml-auto text-sm font-semibold text-primary underline" data-cta="pdp-write-review">
          {m.write}
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-muted">{m.empty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 border-b border-border pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <Rating average={r.rating} count={RATING_MIN_REVIEWS} labels={{ summary: m.stars }} />
                {r.title ? <span className="font-semibold">{r.title}</span> : null}
                {r.isVerifiedBuyer ? <Badge tone="success">{m.verified}</Badge> : null}
              </div>
              <p className="whitespace-pre-wrap">{r.body}</p>
              {photos[r.id]?.length ? (
                <div className="flex gap-2">
                  {photos[r.id]!.map((img) => (
                    <ImageWithFallback key={img.id} image={img} alt={m.photoAlt} className="size-20 rounded-sm object-cover" sizes="80px" />
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted">{m.from(r.authorName, r.districtText)}</p>
              {r.adminReply ? (
                <blockquote className="rounded-sm bg-surface-2 p-3 text-sm">
                  <span className="font-semibold">{m.reply}</span>
                  <p className="whitespace-pre-wrap">{r.adminReply}</p>
                </blockquote>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
