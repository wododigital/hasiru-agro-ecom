import { itemHref as hrefFor } from '../domain';

export interface SearchHitCardProps {
  hit: { kind: string; slug: string; name: string; nameLocal: string | null; scientificName: string | null };
  itemHref: string;
}

/**
 * Text-only result tile: the fallback when the host passes no product cards (search is usable with
 * the catalog alone). Stores normally render their own product card instead.
 */
export function SearchHitCard({ hit, itemHref }: SearchHitCardProps) {
  return (
    <a href={hrefFor(itemHref, hit)} data-cta="search-result" className="flex h-full flex-col gap-1 rounded-md border border-border bg-surface p-4 hover:border-primary-hover">
      <span className="font-semibold text-primary">{hit.name}</span>
      {hit.nameLocal ? <span className="text-sm text-text">{hit.nameLocal}</span> : null}
      {hit.scientificName ? <span className="text-sm text-muted italic">{hit.scientificName}</span> : null}
    </a>
  );
}
