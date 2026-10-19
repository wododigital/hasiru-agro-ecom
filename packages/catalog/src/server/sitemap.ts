import type { SitemapEntry } from '@ecomkit/core/contracts';
import { sitemapEntries } from './queries';

/** sitemapSources entries for the seo module (`products` and `collections` files). */
export async function productEntries(): Promise<SitemapEntry[]> {
  return (await sitemapEntries()).filter((e) => e.path.startsWith('/plant/') || e.path.startsWith('/input/')).map((e) => ({ ...e, changeFrequency: 'weekly' as const }));
}

export async function collectionEntries(): Promise<SitemapEntry[]> {
  const listing = (await sitemapEntries()).filter((e) => e.path.startsWith('/plants/'));
  return [{ path: '/plants', changeFrequency: 'daily' as const }, { path: '/inputs', changeFrequency: 'weekly' as const }, ...listing.map((e) => ({ ...e, changeFrequency: 'weekly' as const }))];
}
