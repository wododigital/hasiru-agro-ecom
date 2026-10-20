// Catalogue facts the calculators read, only through the catalog and pricing public server APIs.
import { getProduct, listProducts, type CardRow } from '@ecomkit/catalog/server';
import { loadBooks } from '@ecomkit/pricing/server';
import type { PriceBook } from '@ecomkit/pricing/domain';
import { SIZE_ROLE, suggestedSpacing, type AgeBand, type CalcPlant, type PlantLine, type SizeClass } from '../domain';

/** Area models whose spacing the plant calculator suggests first (a grid planting; line models never fit). */
const SPACING_PREFERENCE = ['commercial', 'food_forest', 'miyawaki'];
// ponytail: one getProduct per product (catalog's card rows carry no spacing); a batch read in catalog removes it.
const DETAIL_BATCH = 16;

async function details(rows: readonly CardRow[]) {
  const out = [];
  for (let i = 0; i < rows.length; i += DETAIL_BATCH) {
    const batch = await Promise.all(rows.slice(i, i + DETAIL_BATCH).map((r) => getProduct(r.slug)));
    out.push(...batch);
  }
  return out.flatMap((d) => (d ? [d] : []));
}

/** Price books for variants, empty when pricing is not wired (the calculators then show no prices). */
export async function booksFor(variantIds: readonly (string | null)[]): Promise<Record<string, PriceBook>> {
  const ids = variantIds.filter((v): v is string => !!v);
  if (!ids.length) return {};
  try {
    return await loadBooks(ids);
  } catch {
    return {};
  }
}

/** Visible plants with a grid spacing, by name. */
export async function loadCalculatorPlants(): Promise<CalcPlant[]> {
  const { rows } = await listProducts({ kind: 'plant', sort: 'name', limit: 2000 });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (await details(rows)).flatMap(({ product }) => {
    const spacing = suggestedSpacing(product.spacingFt, SPACING_PREFERENCE);
    return spacing ? [{ id: product.id, name: product.name, variantId: byId.get(product.id)?.variantId ?? null, spacing }] : [];
  });
}

export interface InputInfo {
  id: string;
  name: string;
  slug: string;
  variantId: string | null;
}

/** Visible input products by id (hidden or unknown ids are absent). */
export async function loadInputs(ids: readonly string[]): Promise<Map<string, InputInfo>> {
  if (!ids.length) return new Map();
  const { rows } = await listProducts({ ids: [...new Set(ids)], kind: 'input' });
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, slug: r.slug, variantId: r.variantId ?? null }]));
}

/** Plant lines for cart products: role from size class (A12), the plant's own compost kg for the age band. */
export async function plantLinesFor(lines: readonly { productId: string; qty: number }[], ageBand: AgeBand = 'at_planting'): Promise<(PlantLine & { size: SizeClass })[]> {
  const qty = new Map<string, number>();
  for (const l of lines) if (l.qty > 0) qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.qty);
  if (!qty.size) return [];
  const { rows } = await listProducts({ ids: [...qty.keys()], kind: 'plant' });
  return (await details(rows)).flatMap(({ product }) => {
    const size = product.sizeClass as SizeClass | null;
    if (!size) return [];
    return [{ qty: qty.get(product.id) ?? 0, role: SIZE_ROLE[size], size, compostKg: product.compostKg?.[ageBand] ?? null }];
  });
}
