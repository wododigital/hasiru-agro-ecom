import type { PlantClimate } from '@ecomkit/core/contracts';
import { and, eq, isNull, ne, or, type SQL } from 'drizzle-orm';
import { catalogProduct as p, type ProductRow } from '../schema';

/** Listed and reachable on the storefront. */
export const visible = (): SQL =>
  and(eq(p.status, 'active'), isNull(p.deletedAt), or(isNull(p.availabilityOverride), ne(p.availabilityOverride, 'hidden')))!;

type ClimateCols = Pick<ProductRow, 'tempMin' | 'tempOpt' | 'tempMax' | 'rainfallMin' | 'rainfallMax' | 'humidityMin' | 'humidityOpt' | 'humidityMax' | 'soilTags'>;

/** The places contract's climate input, or null when the product has no temperature or rainfall data. */
export function climateOf(r: ClimateCols): PlantClimate | null {
  const temp = r.tempMin != null && r.tempMax != null ? { min: r.tempMin, max: r.tempMax, opt: r.tempOpt } : null;
  const rain = r.rainfallMin != null && r.rainfallMax != null ? { min: r.rainfallMin, max: r.rainfallMax } : null;
  const hum = r.humidityMin != null && r.humidityMax != null ? { min: r.humidityMin, max: r.humidityMax, opt: r.humidityOpt } : null;
  return temp || rain ? { tempC: temp, rainfallMm: rain, humidityPct: hum, soilTags: r.soilTags } : null;
}

/** Storefront path of a collection: /inputs for input collections, /plants/<parent>/<slug> for children. */
export const collectionPath = (c: { slug: string; kind: string; parentSlug?: string | null }): string =>
  c.kind === 'input' ? '/inputs' : c.parentSlug ? `/plants/${c.parentSlug}/${c.slug}` : `/plants/${c.slug}`;
