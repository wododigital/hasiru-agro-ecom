import type { ImageRef } from '@ecomkit/core/contracts';
import { blockJsonLd, cmsRuntime, getPage, imagesFor, resolveBlocks } from '@ecomkit/cms/server';
import { BlockList, JsonLdGraph, pageMetadataFor } from '@ecomkit/cms/ui';
import { ImageWithFallback } from '@ecomkit/ui';
import Link from 'next/link';
import { messages } from '../../messages/en';

const h = messages.home;

async function homePage() {
  try {
    return await getPage('home');
  } catch {
    return null;
  }
}

export async function generateMetadata() {
  return pageMetadataFor(await homePage());
}

/** The accent word of the title (prototype: "farm-scale" in gold) when the heading contains it. */
function Title({ text }: { text: string }) {
  const at = text.indexOf(h.hero.titleAccent);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <em className="text-accent not-italic">{h.hero.titleAccent}</em>
      {text.slice(at + h.hero.titleAccent.length)}
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function SproutIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 22V12M12 12C12 7 8 4 3 4c0 5 4 8 9 8Zm0 0c0-4 3-7 9-7 0 5-4 7-9 7Z" />
    </svg>
  );
}

/** Two-path hero: shop directly, or the guided wizard. Heading, lead and image come from the home page's hero block. */
function Hero({ heading, lead, image }: { heading: string; lead: string; image: ImageRef | null }) {
  const paths = [
    { href: '/plants', p: h.paths.shop, icon: <SearchIcon />, cta: 'home-hero-shop', highlight: false },
    { href: '/plan', p: h.paths.choose, icon: <SproutIcon />, cta: 'home-hero-choose', highlight: true },
  ] as const;
  return (
    <section className="relative isolate overflow-hidden bg-primary-strong text-primary-fg">
      {image ? <ImageWithFallback image={image} alt="" fill preload sizes="100vw" className="-z-20 object-cover" /> : null}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-100 from-primary-strong/95 from-10% to-primary-strong/55 to-70%" />
      <div className="mx-auto flex max-w-6xl flex-col px-4 py-14 md:py-20">
        <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-accent uppercase">{h.hero.eyebrow}</p>
        <h1 className="max-w-2xl font-display text-4xl leading-tight text-primary-fg md:text-6xl">
          <Title text={heading} />
        </h1>
        <p className="mt-3.5 mb-7 max-w-xl text-lg text-primary-fg/85">{lead}</p>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          {paths.map(({ href, p, icon, cta, highlight }) => (
            <Link
              key={href}
              href={href}
              data-cta={cta}
              className={
                highlight
                  ? 'flex flex-col gap-2 rounded-md border border-accent bg-accent p-5 text-accent-fg transition-transform hover:-translate-y-1'
                  : 'flex flex-col gap-2 rounded-md border border-primary-fg/20 bg-primary-fg/10 p-5 backdrop-blur-sm transition hover:-translate-y-1 hover:bg-primary-fg/15'
              }
            >
              <span className={highlight ? 'grid size-10 place-items-center rounded-sm bg-primary-strong/10' : 'grid size-10 place-items-center rounded-sm bg-primary-fg/15'}>{icon}</span>
              <span className="text-lg font-semibold">{p.title}</span>
              <span className="text-sm opacity-85">{p.body}</span>
              <span className="mt-auto pt-1 font-semibold">
                {p.cta}
                <span aria-hidden="true" className="ml-1">
                  →
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Home: the two-path hero, then the cms home blocks in their admin order (best sellers rail, plant calculator,
 * inputs rail, compost calculator, trust band, testimonials, farm development, why choose us). No page title or
 * breadcrumb: the hero carries the h1.
 */
export default async function HomePage() {
  const data = await homePage();
  const hero = data?.blocks.find((b) => b.type === 'hero');
  const heroData = hero?.type === 'hero' ? hero.data : null;
  const blocks = data?.blocks.filter((b) => b.type !== 'hero') ?? [];
  const [ctx, heroImages] = await Promise.all([resolveBlocks(blocks), imagesFor([heroData?.imageId])]);
  return (
    <>
      <Hero heading={heroData?.heading ?? `${h.hero.titleBefore}${h.hero.titleAccent}${h.hero.titleAfter}`} lead={heroData?.subheading ?? h.hero.lead} image={heroData?.imageId ? (heroImages[heroData.imageId] ?? null) : null} />
      <JsonLdGraph nodes={blockJsonLd(blocks, ctx)} crumbs={[]} />
      <BlockList blocks={blocks} ctx={ctx} messages={cmsRuntime().messages} />
    </>
  );
}
