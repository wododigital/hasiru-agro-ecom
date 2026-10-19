import { notFound } from 'next/navigation';
import { getCollection, listingSlugs, topCollections } from '../server/queries';
import { catalogRuntime } from '../server/runtime';
import { ListingPage } from '../ui/ListingPage';
import { atLeastOne, listingMetadata, PLACEHOLDER_SLUG, type SP } from './shared';

type Params = Promise<{ collection: string; sub: string }>;

export async function generateStaticParams() {
  const { collections } = await listingSlugs();
  return atLeastOne(
    collections.flatMap((c) => (c.parentSlug ? [{ collection: c.parentSlug, sub: c.slug }] : [])),
    { collection: PLACEHOLDER_SLUG, sub: PLACEHOLDER_SLUG },
  );
}

async function resolve(parentSlug: string, slug: string) {
  const sub = await getCollection(slug);
  return sub && sub.collection.kind === 'plant' && sub.parent?.slug === parentSlug ? sub : null;
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { collection, sub } = await params;
  const c = await resolve(collection, sub);
  if (!c) return {};
  return listingMetadata(c.collection.seoTitle ?? `${c.collection.name} · ${c.parent!.name}`, c.collection.seoDescription ?? catalogRuntime().messages.listing.plantsIntro, `/plants/${collection}/${sub}`, searchParams);
}

/** A sub-collection (/plants/<collection>/<sub>), with its siblings as chips. */
export default async function SubCollectionPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { collection, sub } = await params;
  const c = await resolve(collection, sub);
  if (!c) notFound();
  const parent = (await getCollection(collection))!;
  const m = catalogRuntime().messages;
  const tops = await topCollections('plant');
  return (
    <ListingPage
      title={c.collection.name}
      titleKn={c.collection.nameKn}
      introHtml={c.collection.introHtml}
      path={`/plants/${collection}/${sub}`}
      breadcrumbs={[{ label: m.nav.home, href: '/' }, { label: m.nav.plants, href: '/plants' }, { label: parent.collection.name, href: `/plants/${collection}` }, { label: c.collection.name }]}
      filter={{ kind: 'plant', collectionSlug: sub }}
      collectionSlug={sub}
      tabs={tops.map((t) => ({ href: `/plants/${t.slug}`, label: t.name, count: t.count, active: t.slug === collection }))}
      subcollections={parent.children.map((ch) => ({ href: `/plants/${collection}/${ch.slug}`, label: ch.name, active: ch.slug === sub }))}
      searchParams={searchParams}
    />
  );
}
