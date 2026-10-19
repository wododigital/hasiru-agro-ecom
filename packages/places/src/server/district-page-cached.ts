import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@ecomkit/core/cache-tags';
import { getDistrictPage, type DistrictPageData } from './district-page';

/** Static per enabled district; refreshed by the `district:<slug>` tag (admin edit, re-seed) or after a day. */
export async function getDistrictPageCached(slug: string): Promise<DistrictPageData | null> {
  'use cache';
  cacheTag(tags.district(slug), tags.catalog);
  cacheLife('days');
  return getDistrictPage(slug);
}
