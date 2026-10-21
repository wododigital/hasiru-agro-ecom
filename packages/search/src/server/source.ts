import type { DbOrTx } from '@ecomkit/core/db';
import { sql } from 'drizzle-orm';
import type { SearchSourceRow } from '../domain/build-index';
import { facetValuesFromProduct, slug } from '../domain/facets';
import { VISIBLE } from './search';

/**
 * Index rows read straight from the catalog tables (BUILD-PLAN section 3 column names), ordered by
 * recommendation (bestsellers, featured, name). Price and stock join in only when the pricing and
 * inventory tables exist, so the index degrades (no price slider, no stock toggle) without them.
 * Tag value labels come back alongside (tags are data, not copy).
 */
export async function loadSearchSource(db: DbOrTx): Promise<{ rows: SearchSourceRow[]; tagLabels: Record<string, string>; labels: Record<string, Record<string, string>> }> {
  const { rows: present } = await db.execute<{ t: string }>(sql`
    select t from unnest(array['catalog_collection', 'catalog_tag', 'catalog_product_tag', 'catalog_variant', 'pricing_price', 'inventory_level']) t
    where to_regclass(t) is not null`);
  const has = new Set(present.map((r) => r.t));
  const tags = has.has('catalog_tag') && has.has('catalog_product_tag');
  const variants = has.has('catalog_variant');

  const collections = has.has('catalog_collection');
  const catCol = collections
    ? sql`(select coalesce(pc.slug, c.slug) from catalog_collection c left join catalog_collection pc on pc.id = c.parent_id where c.id = p.collection_id)`
    : sql`null::text`;

  const tagCol = tags
    ? sql`array(select t.slug from catalog_product_tag pt join catalog_tag t on t.id = pt.tag_id where pt.product_id = p.id order by t.slug)`
    : sql`array[]::text[]`;
  const priceCol =
    variants && has.has('pricing_price')
      ? sql`(select pp.price_paise from catalog_variant v join pricing_price pp on pp.variant_id = v.id where v.product_id = p.id order by v.is_default desc, v.position limit 1)`
      : sql`null::int`;
  const stockCol =
    variants && has.has('inventory_level')
      ? sql`(select coalesce(sum(greatest(il.on_hand - il.reserved, 0)), 0) from catalog_variant v join inventory_level il on il.variant_id = v.id where v.product_id = p.id)`
      : sql`null::int`;

  const { rows } = await db.execute<{
    id: string;
    slug: string;
    kind: string;
    name: string;
    name_kn: string | null;
    scientific_name: string | null;
    search_aliases: string[] | null;
    size_class: string | null;
    propagation: string | null;
    nitrogen_fixer: boolean | null;
    drought_tolerance: string | null;
    water_need: string | null;
    exposure: string | null;
    temp_min: string | null;
    temp_max: string | null;
    rainfall_min: number | null;
    rainfall_max: number | null;
    bearing_years_min: string | null;
    spacing_ft: Record<string, unknown> | null;
    availability_override: string | null;
    published_at: string | Date | null;
    tag_slugs: string[];
    category: string | null;
    subcategory: string | null;
    price_paise: number | null;
    available: string | number | null;
  }>(sql`
    select p.id::text as id, p.slug, p.kind::text as kind, p.name, p.name_kn, p.scientific_name, p.search_aliases,
      p.size_class::text as size_class, p.propagation::text as propagation, p.nitrogen_fixer, p.drought_tolerance::text as drought_tolerance,
      p.water_need::text as water_need, p.exposure::text as exposure, p.temp_min, p.temp_max, p.rainfall_min, p.rainfall_max,
      p.bearing_years_min, p.spacing_ft, p.availability_override::text as availability_override, p.published_at,
      ${tagCol} as tag_slugs, ${catCol} as category, p.subcategory, ${priceCol} as price_paise, ${stockCol} as available
    from catalog_product p
    where ${VISIBLE}
    order by p.is_best_seller desc, p.is_featured desc, p.name, p.id`);

  let tagLabels: Record<string, string> = {};
  if (tags) {
    const { rows: t } = await db.execute<{ slug: string; name: string }>(sql`select slug, name from catalog_tag order by name, slug`);
    tagLabels = Object.fromEntries(t.map((r) => [r.slug, r.name]));
  }
  // Category labels are collection names in collection order; subcategory labels are the stored text.
  let catLabels: Record<string, string> = {};
  if (collections) {
    const { rows: c } = await db.execute<{ slug: string; name: string }>(sql`select slug, name from catalog_collection where parent_id is null order by position, name`);
    catLabels = Object.fromEntries(c.map((r) => [slug(r.slug), r.name]));
  }
  const subLabels = Object.fromEntries(rows.flatMap((r) => (r.subcategory ? [[slug(r.subcategory), r.subcategory]] : [])));

  const n = (v: string | number | null) => (v == null ? null : Number(v));
  const out = rows.map((r): SearchSourceRow => {
    const override = r.availability_override;
    const inStock = override === 'available' ? true : override ? false : r.available == null ? null : Number(r.available) > 0;
    const models = r.spacing_ft ? Object.entries(r.spacing_ft).filter(([, v]) => v != null).map(([k]) => k) : null;
    const published = r.published_at ? new Date(r.published_at).getTime() : null;
    return {
      productId: r.id,
      slug: r.slug,
      kind: r.kind,
      name: r.name,
      nameLocal: r.name_kn,
      scientificName: r.scientific_name,
      aliases: r.search_aliases ?? [],
      facets: facetValuesFromProduct({
        kind: r.kind,
        category: r.category,
        subcategory: r.subcategory,
        sizeClass: r.size_class,
        propagation: r.propagation,
        nitrogenFixer: r.nitrogen_fixer,
        droughtTolerance: r.drought_tolerance,
        waterNeed: r.water_need,
        exposure: r.exposure,
        tempMin: n(r.temp_min),
        tempMax: n(r.temp_max),
        rainfallMin: r.rainfall_min,
        rainfallMax: r.rainfall_max,
        bearingYearsMin: n(r.bearing_years_min),
        models,
        tagSlugs: r.tag_slugs,
        inStock,
      }),
      numeric: {
        price: r.price_paise,
        bear: n(r.bearing_years_min),
        newest: published == null ? null : Math.floor(published / 86_400_000),
      },
    };
  });
  return { rows: out, tagLabels, labels: { cat: catLabels, sub: subLabels } };
}
