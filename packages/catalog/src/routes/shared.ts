import type { Metadata } from 'next';
import { pageMetadata, listingIndexing } from '../server/meta';

export type SP = Promise<Record<string, string | string[] | undefined>>;

/** Metadata for a listing: canonical path (self with ?page=n), noindex,follow when any other query is present. */
export async function listingMetadata(title: string, description: string, path: string, searchParams: SP): Promise<Metadata> {
  const { page, noindex } = listingIndexing(await searchParams);
  return pageMetadata({ title, description, path, page, noindex });
}

/**
 * Cache Components needs at least one entry from generateStaticParams; an empty catalogue (fresh install, build
 * before seeding) prerenders one placeholder path that answers 404.
 */
export const PLACEHOLDER_SLUG = '_none';
export const atLeastOne = <T,>(list: T[], placeholder: T): T[] => (list.length ? list : [placeholder]);
