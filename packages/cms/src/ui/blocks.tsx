import type { ImageRef } from '@ecomkit/core/contracts';
import { ImageWithFallback, Marquee, Rail, Skeleton, buttonVariants, cn } from '@ecomkit/ui';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import type { ProductRailPortProps } from '../server/runtime';
import { isExternalHref, type Block, type BlockData } from '../domain';
import type { CmsMessages } from '../messages';
import type { BlockContext } from '../server/render';
import { cmsRuntime } from '../server/runtime';
import { VideoGrid } from './videos';

type M = CmsMessages;

/** Site links stay client-side navigations; anything else opens normally. */
export function SmartLink({ href, className, children, cta }: { href: string; className?: string; children: ReactNode; cta?: string }) {
  if (isExternalHref(href)) {
    const newTab = href.startsWith('https://');
    return (
      <a href={href} className={className} data-cta={cta} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} data-cta={cta}>
      {children}
    </Link>
  );
}

function Section({ heading, children, className }: { heading?: string | null; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-10', className)}>
      {heading ? <h2 className="font-display text-3xl text-primary">{heading}</h2> : null}
      {children}
    </section>
  );
}

/** Eyebrow, heading and an optional link on the right (product rails, embedded tools). */
function SectionHead({ eyebrow, heading, link, body }: { eyebrow?: string; heading?: string; link?: { label: string; href: string } | null; body?: string }) {
  if (!eyebrow && !heading && !link && !body) return null;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        {eyebrow ? <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">{eyebrow}</p> : null}
        {heading ? <h2 className="font-display text-3xl text-primary">{heading}</h2> : null}
        {body ? <p className="max-w-2xl text-muted">{body}</p> : null}
      </div>
      {link ? (
        <SmartLink href={link.href} cta="cms-section-link" className="font-semibold text-primary underline-offset-4 hover:underline">
          {link.label}
          <span aria-hidden="true" className="ml-1">
            →
          </span>
        </SmartLink>
      ) : null}
    </div>
  );
}

/**
 * Port output is request-time: static shells are prerendered by build workers where the host has not bound its
 * ports, so the port is read only after `connection()` (inside the block's Suspense hole).
 */
async function RailPort(props: ProductRailPortProps) {
  await connection();
  const Port = cmsRuntime().productRail;
  return Port ? <Port {...props} /> : null;
}

async function ComponentPort({ name }: { name: string }) {
  await connection();
  const entry = cmsRuntime().components[name];
  return entry ? <entry.Component /> : null;
}

function ProductRailBlock({ data }: { data: BlockData<'product_rail'> }) {
  const link = data.linkLabel && data.linkHref ? { label: data.linkLabel, href: data.linkHref } : null;
  return (
    <Section>
      <SectionHead eyebrow={data.eyebrow} heading={data.heading} link={link} />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <RailPort source={data.source} value={data.value ?? null} productIds={data.productIds} kind={data.kind} limit={data.limit ?? 12} label={data.heading ?? data.eyebrow ?? data.kind} />
      </Suspense>
    </Section>
  );
}

function ComponentBlock({ data }: { data: BlockData<'component'> }) {
  return (
    <Section>
      <SectionHead eyebrow={data.eyebrow} heading={data.heading} body={data.body} />
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <ComponentPort name={data.key} />
      </Suspense>
    </Section>
  );
}

function Hero({ data, image, h1 }: { data: BlockData<'hero'>; image: ImageRef | null; h1: boolean }) {
  const Heading = h1 ? 'h1' : 'h2';
  return (
    <section className="relative isolate overflow-hidden bg-primary text-primary-fg">
      {image ? <ImageWithFallback image={image} alt="" fill preload={h1} sizes="100vw" className="-z-10 object-cover opacity-40" /> : null}
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-16 md:py-24">
        <Heading className="max-w-3xl font-display text-4xl leading-tight md:text-6xl">{data.heading}</Heading>
        {data.subheading ? <p className="max-w-2xl text-lg opacity-90">{data.subheading}</p> : null}
        {data.ctas.length ? (
          <div className="flex flex-wrap gap-3">
            {data.ctas.map((c, i) => (
              <SmartLink key={c.href} href={c.href} cta={i === 0 ? 'cms-hero-primary' : 'cms-hero-secondary'} className={buttonVariants({ variant: i === 0 ? 'accent' : 'outline', size: 'lg' })}>
                {c.label}
              </SmartLink>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RichText({ html }: { html: string }) {
  // Sanitised with core safeHtml when saved; never rendered from unsanitised input.
  // eslint-disable-next-line react/no-danger -- sanitised rich text
  return <div className="cms-prose mx-auto w-full max-w-3xl px-4 py-6 [&_a]:text-primary-hover [&_a]:underline [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-2xl [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Faq({ data, m }: { data: BlockData<'faq'>; m: M }) {
  return (
    <Section heading={data.heading ?? m.blocks.faqHeading}>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {data.items.map((item) => (
          <details key={item.question} className="group px-4 py-3">
            <summary className="cursor-pointer list-none font-semibold text-primary marker:hidden">{item.question}</summary>
            <p className="mt-2 whitespace-pre-line text-text">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function Cta({ data }: { data: BlockData<'cta'> }) {
  return (
    <Section className="items-start rounded-lg bg-surface-2">
      <h2 className="font-display text-3xl text-primary">{data.heading}</h2>
      {data.body ? <p className="max-w-2xl text-lg text-muted">{data.body}</p> : null}
      <SmartLink href={data.href} cta="cms-cta" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
        {data.label}
      </SmartLink>
    </Section>
  );
}

/** A running band of the shown trust claims (logo + label), paused on hover and static under reduced motion. */
function TrustBand({ heading, ctx, m }: { heading?: string; ctx: BlockContext; m: M }) {
  if (!ctx.trust.length) return null;
  return (
    <section className="border-t-[3px] border-accent bg-primary-strong py-4 text-primary-fg">
      <h2 className="sr-only">{heading ?? m.blocks.trustHeading}</h2>
      <Marquee duration={28}>
        {ctx.trust.map((t) => (
          <span key={t.key} className="flex items-center gap-3 text-lg whitespace-nowrap">
            {t.logoMediaId && ctx.images[t.logoMediaId] ? (
              <span className="relative block h-9 w-14 overflow-hidden rounded-md bg-surface p-0.5">
                <ImageWithFallback image={ctx.images[t.logoMediaId]!} alt="" fill sizes="56px" className="object-contain" />
              </span>
            ) : (
              <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            )}
            <span>{t.value ? `${t.value} ${t.label}` : t.label}</span>
          </span>
        ))}
      </Marquee>
    </section>
  );
}

function Testimonials({ heading, ctx, m, limit }: { heading?: string; ctx: BlockContext; m: M; limit: number }) {
  const list = ctx.testimonials.slice(0, limit);
  if (!list.length) return null;
  return (
    <Section heading={heading ?? m.blocks.testimonialsHeading}>
      <ul className="grid gap-4 md:grid-cols-3">
        {list.map((t) => (
          <li key={t.id}>
            <figure className="flex h-full flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
              <blockquote className="text-text">{t.body}</blockquote>
              <figcaption className="mt-auto flex gap-1.5 text-sm">
                <span className="font-semibold text-primary">{t.name}</span>
                {t.location ? (
                  <>
                    <span aria-hidden="true" className="text-muted">
                      ·
                    </span>
                    <span className="text-muted">{t.location}</span>
                  </>
                ) : null}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const intIN = new Intl.NumberFormat('en-IN');

function Counters({ heading, ctx, m }: { heading?: string; ctx: BlockContext; m: M }) {
  if (!ctx.counters.length) return null;
  return (
    <Section heading={heading ?? m.blocks.countersHeading}>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {ctx.counters.map((c) => (
          <div key={c.key} className="flex flex-col-reverse gap-1 rounded-lg bg-surface p-5 text-center shadow-card">
            <dt className="text-sm text-muted">{c.label}</dt>
            <dd className="font-display text-4xl text-primary tabular-nums">
              {intIN.format(c.value)}
              {c.suffix}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Gallery({ data, ctx, m }: { data: BlockData<'gallery'>; ctx: BlockContext; m: M }) {
  return (
    <Section heading={data.heading ?? m.blocks.galleryHeading}>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {data.imageIds.map((id) => (
          <li key={id} className="relative aspect-[4/3] overflow-hidden rounded-md">
            <ImageWithFallback image={ctx.images[id] ?? null} fill sizes="(min-width: 768px) 33vw, 50vw" className="object-cover" fallbackLabel={m.blocks.galleryImage} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CardRail({ data, ctx }: { data: BlockData<'rail'>; ctx: BlockContext }) {
  const label = data.heading ?? data.items[0]!.title;
  return (
    <Section heading={data.heading}>
      <Rail label={label} itemWidth="260px">
        {data.items.map((item) => (
          <SmartLink key={item.href} href={item.href} cta="cms-rail-card" className="flex h-full flex-col overflow-hidden rounded-lg bg-surface shadow-card">
            <span className="relative block aspect-[4/3]">
              <ImageWithFallback image={item.imageId ? (ctx.images[item.imageId] ?? null) : null} alt="" fill sizes="260px" className="object-cover" />
            </span>
            <span className="flex flex-col gap-1 p-4">
              <span className="font-semibold text-primary">{item.title}</span>
              {item.caption ? <span className="text-sm text-muted">{item.caption}</span> : null}
            </span>
          </SmartLink>
        ))}
      </Rail>
    </Section>
  );
}

function Team({ heading, ctx, m }: { heading?: string; ctx: BlockContext; m: M }) {
  if (!ctx.team.length) return null;
  return (
    <Section heading={heading ?? m.blocks.teamHeading}>
      <ul className="grid gap-5 sm:grid-cols-2 md:grid-cols-4">
        {ctx.team.map((p) => (
          <li key={p.id} className="flex flex-col gap-2">
            <span className="relative block aspect-square overflow-hidden rounded-lg">
              <ImageWithFallback image={p.photoMediaId ? (ctx.images[p.photoMediaId] ?? null) : null} alt={p.name} fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover" />
            </span>
            <span className="font-semibold text-primary">{p.name}</span>
            {p.role ? <span className="text-sm text-muted">{p.role}</span> : null}
            {p.bio ? <p className="text-sm text-text">{p.bio}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Renders resolved blocks in order. The first hero becomes the page's h1 when `heroIsH1` (landing pages); blocks
 * whose content is empty (no verified counters, no shown claims) render nothing rather than an empty band.
 */
export function BlockList({ blocks, ctx, messages: m, heroIsH1 = false }: { blocks: readonly Block[]; ctx: BlockContext; messages: M; heroIsH1?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        const key = `${i}-${b.type}`;
        switch (b.type) {
          case 'hero':
            return <Hero key={key} data={b.data} image={b.data.imageId ? (ctx.images[b.data.imageId] ?? null) : null} h1={heroIsH1 && i === blocks.findIndex((x) => x.type === 'hero')} />;
          case 'rich_text':
            return <RichText key={key} html={b.data.html} />;
          case 'faq':
            return <Faq key={key} data={b.data} m={m} />;
          case 'cta':
            return <Cta key={key} data={b.data} />;
          case 'video':
            return ctx.videos[i]?.length ? (
              <Section key={key} heading={b.data.heading}>
                <VideoGrid videos={ctx.videos[i]!} messages={m} />
              </Section>
            ) : null;
          case 'trust_band':
            return <TrustBand key={key} heading={b.data.heading} ctx={ctx} m={m} />;
          case 'testimonials':
            return <Testimonials key={key} heading={b.data.heading} ctx={ctx} m={m} limit={b.data.limit ?? 6} />;
          case 'counters':
            return <Counters key={key} heading={b.data.heading} ctx={ctx} m={m} />;
          case 'gallery':
            return <Gallery key={key} data={b.data} ctx={ctx} m={m} />;
          case 'rail':
            return <CardRail key={key} data={b.data} ctx={ctx} />;
          case 'team':
            return <Team key={key} heading={b.data.heading} ctx={ctx} m={m} />;
          case 'product_rail':
            return <ProductRailBlock key={key} data={b.data} />;
          case 'component':
            return <ComponentBlock key={key} data={b.data} />;
          default:
            return null;
        }
      })}
    </>
  );
}
