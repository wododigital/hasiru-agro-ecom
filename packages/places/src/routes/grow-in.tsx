import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs, buttonVariants, EmptyState } from '@ecomkit/ui';
import { SLUG_RE } from '@ecomkit/core/ids';
import { format, placesMessages } from '../messages';
import { getDistrictPageCached } from '../server/district-page-cached';
import { listEnabledDistrictSlugs } from '../server/district-page';
import { DistrictFacts } from '../ui/DistrictFacts';
import { DistrictPlantList } from '../ui/DistrictPlantList';

type Params = { params: Promise<{ district: string }> };
const m = placesMessages.district;

/** Cache components need at least one param; `_none` fails SLUG_RE and 404s (same pattern as catalog and cms). */
const PLACEHOLDER = '_none';

export async function generateStaticParams(): Promise<{ district: string }[]> {
  try {
    const slugs = (await listEnabledDistrictSlugs()).map((district) => ({ district }));
    return slugs.length ? slugs : [{ district: PLACEHOLDER }];
  } catch {
    return [{ district: PLACEHOLDER }];
  }
}

async function load(params: Params['params']) {
  const { district } = await params;
  if (!SLUG_RE.test(district)) return null;
  return getDistrictPageCached(district);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = await load(params);
  if (!page) return { robots: { index: false, follow: false } };
  const { district, stateName } = page;
  const path = `/grow-in/${district.slug}`;
  return {
    title: format(m.title, { district: district.name }),
    description: format(m.metaDescription, { district: district.name, state: stateName, tempMin: district.tempMin, tempMax: district.tempMax, rain: Math.round(district.rainfallMm) }),
    alternates: { canonical: path },
    // Pages stay out of search results until six or more plants fit (the 6+ rule).
    robots: page.indexable ? { index: true, follow: true } : { index: false, follow: true },
  };
}

export default async function DistrictPage({ params }: Params) {
  const page = await load(params);
  if (!page) notFound();
  const { district, stateName, plants } = page;
  const crumbs = [{ label: m.breadcrumbPlants, href: '/plants' }, { label: district.name }];
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, ...(c.href ? { item: c.href } : {}) })),
  }).replace(/</g, '\\u003c');

  return (
    <main className="mx-auto w-full max-w-5xl space-y-10 px-4 py-8">
      <Breadcrumbs items={crumbs} />
      <header className="space-y-3">
        <p className="text-sm font-semibold tracking-wide text-accent uppercase">{format(m.heroKicker, { state: stateName })}</p>
        <h1 className="font-display text-4xl text-primary">{format(m.title, { district: district.name })}</h1>
        {district.distanceKmFromNursery !== null ? <p className="text-muted">{format(m.distance, { km: Math.round(district.distanceKmFromNursery) })}</p> : null}
        {/* eslint-disable-next-line react/no-danger -- admin intro is sanitised with safeHtml on save */}
        {district.pageIntroHtml ? <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: district.pageIntroHtml }} /> : null}
      </header>
      <DistrictFacts district={district} />
      <section aria-labelledby="plants-heading" className="space-y-4">
        <h2 id="plants-heading" className="font-display text-2xl text-primary">
          {format(m.plantsHeading, { district: district.name })}
        </h2>
        {plants && plants.length ? (
          <DistrictPlantList plants={plants} />
        ) : (
          <EmptyState title={m.plantsEmpty} action={<Link href="/plants" className={buttonVariants({})}>{m.browseAll}</Link>} />
        )}
      </section>
      <p>
        <Link href={`/plan?district=${district.slug}`} className={buttonVariants({})} data-cta="district-plan-cta">
          {m.planCta}
        </Link>
      </p>
      {/* eslint-disable-next-line react/no-danger -- JSON.stringify output with "<" escaped */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
    </main>
  );
}
