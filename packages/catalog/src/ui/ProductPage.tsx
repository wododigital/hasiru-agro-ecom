import type { ImageRef, JsonLdNode, Paise, PdpSection, PlantClimate } from '@ecomkit/core/contracts';
import { Breadcrumbs, Price, Rail, Rating, Skeleton, StickyBar, buttonVariants, type Crumb } from '@ecomkit/ui';
import { notFound, permanentRedirect } from 'next/navigation';
import { Suspense } from 'react';
import { deriveAvailability, isPurchasable, wantsNotify } from '../domain/availability';
import { productPath } from '../domain/card';
import type { Kind } from '../domain/enums';
import { productFacts } from '../domain/facts';
import { productJsonLdInput } from '../domain/jsonld';
import { getProductCardsByIds } from '../server/api';
import { cachedImages, cachedSettings, pdpCommerce } from '../server/live';
import { getProductBySlug, movedSlug, type ProductDetail } from '../server/queries';
import { catalogRuntime, optionalService } from '../server/runtime';
import { climateOf, collectionPath } from '../server/shared';
import { BuyBoxIsland } from './BuyBoxIsland';
import { FitPanel } from './FitPanel';
import { Gallery } from './Gallery';
import { NotifyForm } from './NotifyForm';
import { FaqList, JsonLdScript, KeyFacts, RichText, TrustRow } from './PdpParts';
import { ProductCard } from './ProductCard';
import { RecentlyViewedIsland } from './RecentlyViewedIsland';
import { TierTable } from './TierTable';

/**
 * Resolves a PDP slug: the product, a 301 for a slug it used to have, or a 404 (unknown, other kind, hidden).
 * `permanentRedirect` and `notFound` throw, so callers only ever get a visible product back.
 */
export async function loadProductOr404(slug: string, kind: Kind): Promise<ProductDetail> {
  const detail = await getProductBySlug(slug);
  if (!detail || detail.product.kind !== kind) {
    const moved = await movedSlug(slug);
    if (moved && moved.kind === kind) permanentRedirect(productPath(moved.kind, moved.slug));
    notFound();
  }
  const p = detail.product;
  if (deriveAvailability({ status: p.status, override: p.availabilityOverride, deletedAt: p.deletedAt, stock: null }) === 'hidden') notFound();
  return detail;
}

function siteUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  return `${base}${path}`;
}

/** The product detail page for /plant/[slug] and /input/[slug]. */
export async function ProductPage({ slug, kind }: { slug: string; kind: Kind }) {
  const detail = await loadProductOr404(slug, kind);
  const rt = catalogRuntime();
  const m = rt.messages;
  const p = detail.product;
  const path = productPath(p.kind, p.slug);
  const variant = detail.variants[0] ?? null;

  // Only cached reads above the fold, so the page shell prerenders; personalised parts stream in Suspense.
  const [{ ladder, stock, reviews: aggregate }, settings, images] = await Promise.all([
    pdpCommerce(p.id, variant?.id ?? null),
    cachedSettings(),
    cachedImages(detail.media.map((x) => x.mediaId)),
  ]);
  const companions = detail.related.filter((r) => r.relation === 'companion').map((r) => r.relatedId);

  const availability = deriveAvailability({ status: p.status, override: p.availabilityOverride, stock });
  const gallery = detail.media.flatMap((x): ImageRef[] => (images[x.mediaId] ? [images[x.mediaId]!] : []));
  const facts = productFacts(p, m);
  const cartEnabled = rt.registry?.has('cart') ?? false;
  const canBuy = cartEnabled && isPurchasable(availability) && !!variant && !!ladder;
  const whatsappHref = settings.whatsappNumber ? `https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent(m.pdp.whatsAppText(p.name, siteUrl(path)))}` : null;

  const crumbs: Crumb[] = [
    { label: m.nav.home, href: '/' },
    kind === 'input' ? { label: m.nav.inputs, href: '/inputs' } : { label: m.nav.plants, href: '/plants' },
    ...(detail.collection?.parent ? [{ label: detail.collection.parent.name, href: collectionPath({ slug: detail.collection.parent.slug, kind }) }] : []),
    ...(detail.collection && kind === 'plant'
      ? [{ label: detail.collection.name, href: collectionPath({ slug: detail.collection.slug, kind, parentSlug: detail.collection.parent?.slug ?? null }) }]
      : []),
    { label: p.name },
  ];

  let jsonLd: string | null = null;
  if (rt.jsonLd) {
    const nodes: JsonLdNode[] = [];
    const input = productJsonLdInput({
      name: p.name,
      path,
      sku: p.sku,
      description: p.shortDescription ?? p.seoDescription,
      images: gallery.map((g) => g.src),
      listUnitPaise: ladder?.list.unitPaise ?? null,
      tiers: ladder?.tiers ?? [],
      availability,
      reviews: aggregate,
      facts,
      now: rt.now(),
    });
    if (input) nodes.push(rt.jsonLd.product(input));
    nodes.push(rt.jsonLd.breadcrumbs(crumbs.map((c) => ({ name: c.label, path: c.href ?? path }))));
    if (detail.faqs.length) nodes.push(rt.jsonLd.faqPage(detail.faqs.map((f) => ({ question: f.question, answer: f.answerHtml }))));
    jsonLd = rt.jsonLd.graph(nodes);
  }

  const sections = rt.registry?.list('pdpSections') ?? [];
  const slot = (where: PdpSection['slot']) =>
    sections
      .filter((s) => s.slot === where)
      .map((s) => (
        <Suspense key={`${s.moduleId}:${s.id}`} fallback={<Skeleton className="h-24 rounded-md" />}>
          <PdpSlot section={s} productId={p.id} slug={p.slug} />
        </Suspense>
      ));
  const climate = climateOf(p);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 pb-24 md:pb-6" data-availability={availability}>
      <JsonLdScript json={jsonLd} />
      <Breadcrumbs items={crumbs} />
      <div className="grid gap-6 md:grid-cols-2">
        <Gallery images={gallery} name={p.name} messages={m} />
        <div className="flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h1 className="font-display text-3xl text-primary-strong">{p.name}</h1>
            {p.nameKn ? (
              <p lang="kn" className="text-lg text-muted">
                {p.nameKn}
              </p>
            ) : null}
            {p.scientificName ? <p className="text-sm text-muted italic">{p.scientificName}</p> : null}
            {aggregate ? <Rating average={aggregate.average} count={aggregate.count} /> : null}
          </header>
          {p.shortDescription ? <p>{p.shortDescription}</p> : null}
          <StockLine availability={availability} available={stock?.available ?? null} readyInDays={stock?.readyInDays ?? null} messages={m} />
          {ladder && variant ? (
            <BuyBoxIsland
              name={p.name}
              variants={detail.variants.map((v) => ({ id: v.id, label: v.label }))}
              list={ladder.list}
              tiers={ladder.tiers}
              canBuy={canBuy}
              whatsappHref={whatsappHref}
              labels={m.pdp}
            />
          ) : whatsappHref ? (
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })} data-cta="pdp-ask-whatsapp">
              {m.pdp.askWhatsApp}
            </a>
          ) : null}
          {wantsNotify(availability) && variant ? <NotifyForm variantId={variant.id} messages={m} /> : null}
          {ladder ? <TierTable list={ladder.list} tiers={ladder.tiers} messages={m} quoteHref={whatsappHref} /> : null}
          {kind === 'plant' && climate ? (
            <Suspense fallback={<Skeleton className="h-28 rounded-md" />}>
              <DistrictFit climate={climate} />
            </Suspense>
          ) : null}
          <TrustRow messages={m} />
          {slot('aside')}
        </div>
      </div>
      {slot('main')}
      <KeyFacts facts={facts} messages={m} />
      <RichText id="description-title" title={m.pdp.description} html={p.descriptionHtml} />
      <RichText id="care-title" title={m.pdp.care} html={p.careHtml} />
      <FaqList faqs={detail.faqs} messages={m} />
      {companions.length ? (
        <Suspense fallback={<Skeleton className="h-64 rounded-md" />}>
          <RelatedRail ids={companions} cartEnabled={cartEnabled} />
        </Suspense>
      ) : null}
      {slot('below')}
      <RecentlyViewedIsland current={{ href: path, name: p.name }} title={m.pdp.recentlyViewed} />
      {ladder ? (
        <StickyBar>
          <span className="flex flex-col">
            <span className="text-sm font-semibold">{p.name}</span>
            <Price paise={ladder.list.unitPaise as Paise} size="sm" />
          </span>
          <a href={canBuy ? '#buy' : '#notify'} className={buttonVariants({ size: 'sm' })} data-cta="pdp-sticky-add">
            {canBuy ? m.pdp.stickyAdd : m.card.notifyMe}
          </a>
        </StickyBar>
      ) : null}
    </div>
  );
}

function StockLine({ availability, available, readyInDays, messages }: { availability: string; available: number | null; readyInDays: number | null; messages: ProductPageMessages }) {
  const c = messages.card;
  const text =
    availability === 'low_stock' && available != null
      ? c.onlyLeft(available)
      : availability === 'in_stock'
        ? c.inStock
        : availability === 'preorder'
          ? c.preorder(readyInDays)
          : availability === 'coming_soon'
            ? c.comingSoon
            : availability === 'temporarily_unavailable'
              ? c.unavailable
              : c.outOfStock;
  return <p className={availability === 'out_of_stock' || availability === 'temporarily_unavailable' ? 'font-semibold text-danger' : availability === 'low_stock' ? 'font-semibold text-warning' : 'text-success'}>{text}</p>;
}

type ProductPageMessages = ReturnType<typeof catalogRuntime>['messages'];

/** District fit, personalised per visitor (district cookie), so it streams inside its own Suspense boundary. */
async function DistrictFit({ climate }: { climate: PlantClimate }) {
  const rt = catalogRuntime();
  const places = await optionalService('places');
  if (!places) return null;
  const slug = await rt.readDistrict();
  const district = slug ? await places.getDistrict(slug) : null;
  const fit = district ? await places.fit(district.slug, climate) : null;
  return <FitPanel district={district} fit={fit} messages={rt.messages} chooseHref={rt.registry?.has('planting') ? '/plan' : null} />;
}

/** Companion products as cards (prices and stock per request). */
async function RelatedRail({ ids, cartEnabled }: { ids: readonly string[]; cartEnabled: boolean }) {
  const m = catalogRuntime().messages;
  const related = await getProductCardsByIds(ids);
  if (!related.length) return null;
  return (
    <section aria-labelledby="related-title" className="flex flex-col gap-2">
      <h2 id="related-title" className="font-display text-xl">
        {m.pdp.related}
      </h2>
      <Rail label={m.pdp.related} itemWidth="220px">
        {related.map((c) => (
          <ProductCard key={c.id} card={c} cartEnabled={cartEnabled} messages={m} />
        ))}
      </Rail>
    </section>
  );
}

/** One pdpSections entry from another module (lazy component, rendered in its slot). */
async function PdpSlot({ section, productId, slug }: { section: PdpSection; productId: string; slug: string }) {
  const Component = await section.component();
  return <Component productId={productId} slug={slug} />;
}
