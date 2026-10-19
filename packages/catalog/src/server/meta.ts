import type { MetadataInput } from '@ecomkit/core/contracts';
import type { Metadata } from 'next';
import { catalogRuntime } from './runtime';

/** Page metadata through the seo module's builder when bound; a plain canonical + robots fallback otherwise. */
export function pageMetadata(input: MetadataInput): Metadata {
  const build = catalogRuntime().metadata;
  if (build) return build(input);
  const canonical = input.page && input.page > 1 ? `${input.path}?page=${input.page}` : input.path;
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical },
    robots: input.noindex ? { index: false, follow: true } : undefined,
    openGraph: { title: input.title, description: input.description, type: input.type === 'article' ? 'article' : 'website' },
  };
}

type Params = Record<string, string | string[] | undefined>;

/** Listing query state: `page` alone keeps a self canonical; any other parameter (sort, facets) is noindex,follow. */
export function listingIndexing(searchParams: Params): { page: number; noindex: boolean } {
  const raw = searchParams.page;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  const page = Number.isInteger(n) && n > 1 && n < 10_000 ? n : 1;
  const others = Object.keys(searchParams).filter((k) => k !== 'page' && searchParams[k] !== undefined);
  return { page, noindex: others.length > 0 };
}
