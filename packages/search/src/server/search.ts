import type { DbOrTx } from '@ecomkit/core/db';
import { sql } from 'drizzle-orm';
import { normalise } from '../domain/suggest';

export interface SearchHit {
  id: string;
  slug: string;
  kind: string;
  name: string;
  nameLocal: string | null;
  scientificName: string | null;
}

/** Storefront-visible products: active, not deleted, published, not hidden. Shared by search and the index source. */
export const VISIBLE = sql`p.status = 'active' and p.deleted_at is null and (p.published_at is null or p.published_at <= now()) and coalesce(p.availability_override::text, '') <> 'hidden'`;

const HAYSTACK = sql`search_haystack(p.name, p.name_kn, p.scientific_name, p.search_aliases)`;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * trgm `ILIKE` over name, local-language name, scientific name and aliases (one expression index,
 * sql/trgm.sql). Every token must appear; name-prefix matches rank first, then trigram similarity.
 */
export async function searchProducts(db: DbOrTx, query: string, options: { limit?: number } = {}): Promise<SearchHit[]> {
  const tokens = normalise(query).split(' ').filter(Boolean).slice(0, 6);
  if (!tokens.length || tokens.join('').length < 2) return [];
  const phrase = tokens.join(' ');
  // One ILIKE per token, ANDed: each is served by the trgm index (`ILIKE ALL (array)` is not).
  const match = sql.join(tokens.map((t) => sql`${HAYSTACK} ilike ${`%${likeEscape(t)}%`}`), sql` and `);
  const { rows } = await db.execute<{ id: string; slug: string; kind: string; name: string; name_kn: string | null; scientific_name: string | null }>(sql`
    select p.id::text as id, p.slug, p.kind::text as kind, p.name, p.name_kn, p.scientific_name
    from catalog_product p
    where ${VISIBLE} and ${match}
    order by (lower(p.name) like ${`${likeEscape(phrase)}%`}) desc,
             similarity(${HAYSTACK}, ${phrase}) desc,
             p.is_best_seller desc, p.name
    limit ${options.limit ?? 96}`);
  return rows.map((r) => ({ id: r.id, slug: r.slug, kind: r.kind, name: r.name, nameLocal: r.name_kn, scientificName: r.scientific_name }));
}
