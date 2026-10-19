/** Facet value keys travel in URLs: lowercase, digits, `_`, `.` and `-`. */
export const VALUE_RE = /^[a-z0-9][a-z0-9_.-]{0,39}$/;
export const KEY_RE = /^[a-z][a-z0-9_]{0,15}$/;

export interface FacetDef {
  key: string;
  /** `multi`: checkbox list, OR within. `toggle`: one checkbox for `toggleValue`. */
  kind: 'multi' | 'toggle';
  toggleValue?: string;
  /** Lower = more important. Closest-match relaxation drops the highest number first. */
  priority: number;
}

export interface RangeDef {
  key: string;
  /** Numeric column in the index (`price` is paise). */
  numeric: string;
  /** URL and input unit = stored value / scale (paise -> rupees = 100). */
  scale: number;
  /** `money`: stored value is paise, shown with formatINR. */
  format: 'money' | 'number';
  priority: number;
  /** Preset brackets in URL units. */
  presets: readonly { min: number | null; max: number | null }[];
}

export interface QuickPreset {
  id: string;
  values?: Readonly<Record<string, readonly string[]>>;
  ranges?: Readonly<Record<string, { min: number | null; max: number | null }>>;
}

export const SORTS = ['recommended', 'relevance', 'price_asc', 'price_desc', 'bearing', 'newest'] as const;
export type SortKey = (typeof SORTS)[number];

/** Everything the engine and the URL codec need. Serializable (passed to client islands). */
export interface FacetConfig {
  facets: readonly FacetDef[];
  ranges: readonly RangeDef[];
  /** Selection applied when the URL has no `f` (in stock on by default). */
  defaults: Readonly<Record<string, readonly string[]>>;
  presets: readonly QuickPreset[];
  /** Sidebar shows this many groups open; the rest start collapsed. */
  openGroups: number;
  pageSize: number;
}

/** Default facet set (cro-ux 2.1), in buying-intent order. A host may pass its own config. */
export const DEFAULT_FACET_CONFIG: FacetConfig = {
  facets: [
    { key: 'fit', kind: 'toggle', toggleValue: 'yes', priority: 1 },
    { key: 'stock', kind: 'toggle', toggleValue: 'in', priority: 9 },
    { key: 'kind', kind: 'multi', priority: 2 },
    { key: 'model', kind: 'multi', priority: 3 },
    { key: 'size', kind: 'multi', priority: 4 },
    { key: 'rain', kind: 'multi', priority: 6 },
    { key: 'temp', kind: 'multi', priority: 7 },
    { key: 'drought', kind: 'toggle', toggleValue: 'high', priority: 5 },
    { key: 'water', kind: 'multi', priority: 8 },
    { key: 'prop', kind: 'multi', priority: 10 },
    { key: 'nfix', kind: 'toggle', toggleValue: 'yes', priority: 11 },
    { key: 'sun', kind: 'multi', priority: 12 },
    { key: 'bear', kind: 'multi', priority: 13 },
    { key: 'tag', kind: 'multi', priority: 14 },
  ],
  ranges: [{ key: 'price', numeric: 'price', scale: 100, format: 'money', priority: 8, presets: [{ min: null, max: 300 }, { min: 300, max: 1000 }, { min: 1000, max: null }] }],
  defaults: { stock: ['in'] },
  presets: [
    { id: 'fit', values: { fit: ['yes'] } },
    { id: 'drought', values: { drought: ['high'] } },
    { id: 'food_forest', values: { model: ['food_forest'] } },
    { id: 'under_300', ranges: { price: { min: null, max: 300 } } },
    { id: 'fast_bearing', values: { bear: ['lt2'] } },
  ],
  openGroups: 6,
  pageSize: 24,
};

/** Product facts the facet values derive from (camelCase of the catalog columns). */
export interface ProductFacts {
  kind: string;
  sizeClass?: string | null;
  propagation?: string | null;
  nitrogenFixer?: boolean | null;
  droughtTolerance?: string | null;
  waterNeed?: string | null;
  exposure?: string | null;
  tempMin?: number | null;
  tempMax?: number | null;
  rainfallMin?: number | null;
  rainfallMax?: number | null;
  bearingYearsMin?: number | null;
  /** Model keys whose spacing is set (food_forest, miyawaki, commercial, boundary). */
  models?: readonly string[] | null;
  tagSlugs?: readonly string[];
  inStock?: boolean | null;
}

const RAIN_BUCKETS: readonly [string, number, number][] = [
  ['lt600', 0, 600],
  ['600-1000', 600, 1000],
  ['1000-1500', 1000, 1500],
  ['1500-2500', 1500, 2500],
  ['gt2500', 2500, Number.POSITIVE_INFINITY],
];

/** Rainfall buckets the range [min, max] overlaps (overlap match, not equality). */
export function rainBuckets(min: number | null | undefined, max: number | null | undefined): string[] {
  if (min == null && max == null) return [];
  const lo = min ?? max!;
  const hi = max ?? min!;
  return RAIN_BUCKETS.filter(([, a, b]) => lo < b && hi >= a).map(([k]) => k);
}

export function bearBucket(years: number | null | undefined): string | null {
  if (years == null) return null;
  if (years < 2) return 'lt2';
  if (years < 4) return '2-4';
  if (years < 7) return '4-7';
  return '7plus';
}

const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const SIZE: Record<string, string> = { l: 'large', m: 'medium', s: 'small' };

/**
 * Facet values for one product. A key present with [] means "known, no value" (counts as known for the
 * auto-hide rule); an absent key means unknown.
 */
export function facetValuesFromProduct(p: ProductFacts): Record<string, string[]> {
  const out: Record<string, string[]> = { kind: [slug(p.kind)] };
  const one = (key: string, v: string | null | undefined) => {
    if (v != null && v !== '') out[key] = [slug(v)];
  };
  if (p.sizeClass) out.size = [SIZE[p.sizeClass.toLowerCase()] ?? slug(p.sizeClass)];
  one('prop', p.propagation);
  one('drought', p.droughtTolerance);
  one('water', p.waterNeed);
  one('sun', p.exposure);
  if (p.nitrogenFixer != null) out.nfix = [p.nitrogenFixer ? 'yes' : 'no'];
  if (p.tempMin != null || p.tempMax != null) {
    out.temp = [...(p.tempMax != null && p.tempMax >= 40 ? ['heat'] : []), ...(p.tempMin != null && p.tempMin <= 10 ? ['cold'] : [])];
  }
  if (p.rainfallMin != null || p.rainfallMax != null) out.rain = rainBuckets(p.rainfallMin, p.rainfallMax);
  const bear = bearBucket(p.bearingYearsMin);
  if (bear) out.bear = [bear];
  if (p.models) out.model = p.models.map(slug);
  if (p.tagSlugs?.length) out.tag = p.tagSlugs.map(slug);
  if (p.inStock != null) out.stock = [p.inStock ? 'in' : 'out'];
  for (const [k, vs] of Object.entries(out)) out[k] = [...new Set(vs.filter((v) => VALUE_RE.test(v)))];
  return out;
}
