import { getViewer } from '@ecomkit/core/auth-context';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { reviewsMessages } from '../messages';
import { getReviewPorts, listMyReviews } from '../server';
import { AccountReviews } from '../ui/AccountReviews';

type Props = { searchParams: Promise<Record<string, string | undefined>> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateMetadata(): Metadata {
  return { title: reviewsMessages.account.title, robots: { index: false, follow: false } };
}

/** /account/reviews (?product=<id> opens the write form, ?edit=<id> the edit form, ?review=<outcome> the notice). */
export default async function AccountReviewsPage({ searchParams }: Props) {
  const q = await searchParams;
  // reviews does not depend on auth, so the login redirect is spelled out (same target as auth's requireCustomer).
  // A review-request link (?product=<id>) survives the sign-in.
  if ((await getViewer()).kind !== 'customer') {
    const back = q.product && UUID_RE.test(q.product) ? `/account/reviews?product=${q.product}` : '/account/reviews';
    redirect(`/account/login?next=${encodeURIComponent(back)}`);
  }
  const mine = await listMyReviews();
  const { products, images } = getReviewPorts();
  const labels = await Promise.all(mine.map((r) => products?.label(r.productId) ?? null));
  const reviews = mine.map((r, i) => ({ ...r, productName: labels[i]?.name ?? null, productHref: labels[i]?.href ?? null }));
  const editing = q.edit ? (mine.find((r) => r.id === q.edit) ?? null) : null;
  const productId = q.product && UUID_RE.test(q.product) && !mine.some((r) => r.productId === q.product) ? q.product : null;
  const writeFor = productId ? { productId, name: (await products?.label(productId))?.name ?? null } : null;
  return <AccountReviews reviews={reviews} writeFor={writeFor} editing={editing} outcome={q.review} photosEnabled={!!images} />;
}
