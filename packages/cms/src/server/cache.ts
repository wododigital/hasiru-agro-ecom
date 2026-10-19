import { invalidateTags } from '@ecomkit/core/cache-tags';
import { cacheLife, cacheTag, updateTag } from 'next/cache';

// ponytail: same two helpers as the catalog's and seo's; they belong in @ecomkit/core/cache-tags (cross-package request in
// BUILD-STATUS/wp-09.md). Delete this file when core exports them.

/** Inside a 'use cache' function: a life (default days) plus tags. Outside Next (tests, scripts) there is no cache scope. */
export function cacheFor(tagList: readonly string[], life: 'hours' | 'days' = 'days'): void {
  try {
    cacheLife(life);
    if (tagList.length) cacheTag(...tagList);
  } catch {
    // not inside a cache scope
  }
}

/** After an admin write: updateTag inside a server action, else core's invalidateTags. */
export async function expireTags(tagList: readonly string[]): Promise<void> {
  const unique = [...new Set(tagList)];
  if (!unique.length) return;
  try {
    for (const tag of unique) updateTag(tag);
  } catch {
    await invalidateTags(unique);
  }
}
