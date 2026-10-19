import { invalidateTags } from '@ecomkit/core/cache-tags';
import { cacheLife, cacheTag, updateTag } from 'next/cache';

/**
 * Inside a 'use cache' function: day-long life plus the given tags. Outside Next (scripts, tests) the calls
 * throw because there is no cache scope; that is ignored and the read is simply not cached.
 */
export function cacheFor(tagList: readonly string[]): void {
  try {
    cacheLife('days');
    if (tagList.length) cacheTag(...tagList);
  } catch {
    // not inside a cache scope
  }
}

/**
 * After an admin write: `updateTag` (read-your-own-writes in the server action that made the change);
 * anywhere else core's invalidateTags (revalidateTag, or the worker's internal endpoint).
 */
export async function expireTags(tagList: readonly string[]): Promise<'update' | 'invalidate'> {
  const unique = [...new Set(tagList)];
  if (!unique.length) return 'update';
  try {
    for (const tag of unique) updateTag(tag);
    return 'update';
  } catch {
    await invalidateTags(unique);
    return 'invalidate';
  }
}
