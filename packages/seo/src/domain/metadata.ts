import type { ImageRef, MetadataInput } from '@ecomkit/core/contracts';
import { canonicalUrl, localisedPath, normalisePath } from './paths';
import { absoluteUrl, type SiteIdentity } from './site';

/** The subset of Next's `Metadata` this module fills (structurally assignable to it; a type test pins that). */
export interface SeoMetadata {
  title: { absolute: string };
  description: string;
  alternates: { canonical: string; languages?: Record<string, string> };
  robots: { index: boolean; follow: boolean };
  openGraph: {
    type: 'website' | 'article';
    url: string;
    title: string;
    description: string;
    siteName: string;
    locale: string;
    images: { url: string; width?: number; height?: number; alt?: string }[];
  };
  twitter: { card: 'summary_large_image'; title: string; description: string; images: string[] };
}

/** A page-level override an admin entered for one path (seo_page_meta). */
export interface PageMetaOverride {
  title: string | null;
  description: string | null;
  noindex: boolean;
  canonical: string | null;
}

/** Search snippets: Google shows about 60 title chars and 160 description chars. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

export function composeTitle(title: string, siteName: string): string {
  const t = title.trim();
  if (!t) return siteName;
  return t === siteName || t.endsWith(`| ${siteName}`) ? t : `${t} | ${siteName}`;
}

/** Collapses whitespace and cuts at a word boundary with an ellipsis when longer than `max`. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s,.;:]+$/, '')}…`;
}

/** Default social image: the OG route renders a card for any path. */
export const ogPathFor = (path: string) => `/og${path === '/' ? '/home' : path}`;

/**
 * Next metadata for a page: absolute title with the site name, absolute pinned canonical (query stripped,
 * `?page=n` kept on paginated listings), robots, Open Graph and Twitter cards, hreflang when kn is enabled.
 * `override` (admin page meta) wins field by field.
 */
export function metadataFor(input: MetadataInput, site: SiteIdentity, override: PageMetaOverride | null = null): SeoMetadata {
  const path = normalisePath(input.path) ?? '/';
  const title = composeTitle(override?.title || input.title, site.name);
  const description = clip(override?.description || input.description || site.description, DESCRIPTION_MAX);
  const canonical = override?.canonical ? canonicalUrl(site, override.canonical) : canonicalUrl(site, path, { page: input.page });
  const noindex = Boolean(input.noindex || override?.noindex);

  const image: ImageRef | string = input.image ?? ogPathFor(path);
  const ogImage =
    typeof image === 'string'
      ? { url: absoluteUrl(site, image), width: 1200, height: 630, alt: title }
      : { url: absoluteUrl(site, image.src), width: image.width, height: image.height, alt: image.alt || title };

  const languages = site.locales.includes('kn-IN')
    ? { 'en-IN': canonicalUrl(site, path), 'kn-IN': canonicalUrl(site, localisedPath(path, 'kn-IN')), 'x-default': canonicalUrl(site, path) }
    : undefined;

  return {
    title: { absolute: title },
    description,
    alternates: languages ? { canonical, languages } : { canonical },
    robots: { index: !noindex, follow: true },
    openGraph: {
      type: input.type === 'article' ? 'article' : 'website',
      url: canonical,
      title,
      description,
      siteName: site.name,
      locale: (input.locale ?? 'en-IN').replace('-', '_'),
      images: [ogImage],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage.url] },
  };
}
