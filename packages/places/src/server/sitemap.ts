import 'server-only';
import type { SitemapEntry } from '@ecomkit/core/contracts';
import { getDistrictPage, listEnabledDistrictSlugs } from './district-page';

/** `/sitemap/districts.xml`: only enabled pages that clear the 6+ fitting plants rule. */
export async function districtSitemapEntries(): Promise<SitemapEntry[]> {
  const out: SitemapEntry[] = [];
  for (const slug of await listEnabledDistrictSlugs()) {
    const page = await getDistrictPage(slug);
    if (page?.indexable) out.push({ path: `/grow-in/${slug}`, changeFrequency: 'monthly', priority: page.district.stateCode === 'KA' ? 0.6 : 0.4 });
  }
  return out;
}
