// Step 9.11: old WooCommerce URLs -> new URLs. Product URLs point at the product (active now for client
// rows and Agarwood; `pending` for drafts, which fall back to their collection page until published).
// Old category URLs point at the matching collection. Old slugs are derived WordPress-style from the Woo
// names (the old product sitemap is not fetched at build time).
import { join } from 'node:path';
// @boundaries-ignore type-only: the seed-hook contract; @tooling/scripts cannot depend on core (core depends on it for db helpers)
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { once, slugify, SOURCES, writeSeedFile } from './lib/common';
import { buildProducts } from './fill-gaps';

export interface RedirectRecord {
  from: string;
  to_sku: string | null;
  to_path: string | null;
  code: 301;
  status: 'pending' | 'active';
}

export const COLLECTION_PATH: Record<string, string> = {
  timber: '/plants/timber-trees',
  fruiting: '/plants/fruiting-trees',
  other: '/plants/other-plants',
};
/** Sub-collection paths (plan 4.1) by subcategory label. */
export const SUBCOLLECTION_PATH: Record<string, string> = {
  Desi: '/plants/fruiting-trees/desi',
  Exotic: '/plants/fruiting-trees/exotic',
  'Forest fruit': '/plants/fruiting-trees/forest-fruit',
  Timber: '/plants/timber-trees',
  Spices: '/plants/other-plants/spices',
  Plantation: '/plants/other-plants/plantation',
  'Native & medicinal': '/plants/other-plants/native-medicinal',
  'Biomass & support': '/plants/other-plants/biomass-support',
};
/** Old Woo product categories (CSV "Categories") -> new collection pages. */
const OLD_CATEGORIES: Record<string, string> = {
  'Desi Fruits': '/plants/fruiting-trees/desi',
  'Exotic fruits': '/plants/fruiting-trees/exotic',
  Forestry: '/plants/timber-trees',
  Spices: '/plants/other-plants/spices',
  Plantation: '/plants/other-plants/plantation',
};

export const buildRedirects = once((): RedirectRecord[] => {
  const out = new Map<string, RedirectRecord>();
  for (const p of buildProducts().products) {
    for (const from of p.seo.legacy_urls) {
      if (out.has(from)) throw new Error(`two products claim the old URL ${from}`);
      const active = p.status === 'active';
      out.set(from, { from, to_sku: p.sku, to_path: active ? null : (SUBCOLLECTION_PATH[p.subcategory] ?? COLLECTION_PATH[p.collection] ?? '/plants'), code: 301, status: active ? 'active' : 'pending' });
    }
  }
  for (const [cat, to] of Object.entries(OLD_CATEGORIES)) {
    const from = `/product-category/${slugify(cat)}`;
    out.set(from, { from, to_sku: null, to_path: to, code: 301, status: 'active' });
  }
  out.set('/shop', { from: '/shop', to_sku: null, to_path: '/plants', code: 301, status: 'active' });
  return [...out.values()].sort((a, b) => a.from.localeCompare(b.from));
});

export default async function step(ctx: SeedContext): Promise<void> {
  const r = buildRedirects();
  writeSeedFile(join(ctx.seedDir, 'redirects.json'), [SOURCES.woo], r, ctx);
  ctx.log.info(`legacy-redirects: ${r.length} (${r.filter((x) => x.status === 'pending').length} pending until publish)`);
}
