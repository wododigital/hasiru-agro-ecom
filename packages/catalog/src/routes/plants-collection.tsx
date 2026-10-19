import { notFound } from 'next/navigation';
import { getCollection, getCuratedTag, listingSlugs, listProducts, topCollections } from '../server/queries';
import { catalogRuntime } from '../server/runtime';
import { ListingPage } from '../ui/ListingPage';
import { atLeastOne, listingMetadata, PLACEHOLDER_SLUG, type SP } from './shared';

type Params = Promise<{ collection: string }>;

export async function generateStaticParams() {
  const { collections, traits } = await listingSlugs();
  return atLeastOne([...collections.filter((c) => !c.parentSlug).map((c) => ({ collection: c.slug })), ...traits.map((t) => ({ collection: t }))], { collection: PLACEHOLDER_SLUG });
}

/** A top-level plant collection, or a curated trait page (trait tag with products); anything else 404s. */
async function resolve(slug: string) {
  const collection = await getCollection(slug);
  if (collection && collection.collection.kind === 'plant' && !collection.parent) return { type: 'collection' as const, collection };
  const tag = await getCuratedTag(slug);
  if (tag && (await listProducts({ kind: 'plant', tagSlug: slug, limit: 1 })).total > 0) return { type: 'trait' as const, tag };
  return null;
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { collection: slug } = await params;
  const r = await resolve(slug);
  if (!r) return {};
  const title = r.type === 'collection' ? (r.collection.collection.seoTitle ?? r.collection.collection.name) : r.tag.name;
  const description = r.type === 'collection' ? (r.collection.collection.seoDescription ?? catalogRuntime().messages.listing.plantsIntro) : catalogRuntime().messages.listing.plantsIntro;
  return listingMetadata(title, description, `/plants/${slug}`, searchParams);
}

export default async function CollectionPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { collection: slug } = await params;
  const r = await resolve(slug);
  if (!r) notFound();
  const m = catalogRuntime().messages;
  const tops = await topCollections('plant');
  const crumbs = [{ label: m.nav.home, href: '/' }, { label: m.nav.plants, href: '/plants' }];
  if (r.type === 'trait') {
    return (
      <ListingPage
        title={r.tag.name}
        titleKn={r.tag.nameKn}
        introHtml={r.tag.introHtml}
        path={`/plants/${slug}`}
        breadcrumbs={[...crumbs, { label: r.tag.name }]}
        filter={{ kind: 'plant', tagSlug: slug }}
        searchParams={searchParams}
      />
    );
  }
  const c = r.collection;
  return (
    <ListingPage
      title={c.collection.name}
      titleKn={c.collection.nameKn}
      introHtml={c.collection.introHtml}
      path={`/plants/${slug}`}
      breadcrumbs={[...crumbs, { label: c.collection.name }]}
      filter={{ kind: 'plant', collectionSlug: slug }}
      collectionSlug={slug}
      tabs={tops.map((t) => ({ href: `/plants/${t.slug}`, label: t.name, count: t.count, active: t.slug === slug }))}
      subcollections={c.children.map((ch) => ({ href: `/plants/${slug}/${ch.slug}`, label: ch.name, active: false }))}
      searchParams={searchParams}
    />
  );
}
