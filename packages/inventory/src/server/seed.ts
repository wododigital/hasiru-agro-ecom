// Seed hook `inventory.levels`: data/seed/{products,inputs}.json variants -> inventory_level (source `seed`, A26).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SeedLevel } from '../domain';
import { seedLevels } from './stock';

const seedFile = z.object({
  records: z.array(
    z.object({
      sku: z.string(),
      variants: z.array(
        z.object({
          sku: z.string().optional(),
          stock_qty: z.number().int().nullish(),
          ready_in_days: z.number().int().nullish(),
          low_stock_threshold: z.number().int().nullish(),
        }),
      ),
    }),
  ),
});

export type VariantRef = { variantId: string; productId: string };
export type VariantResolver = (skus: readonly string[]) => Promise<Record<string, VariantRef>>;

/**
 * Variant ids are catalog-generated, so sku -> id comes from the catalog's public server API
 * (`variantRefsBySku`, requested from catalog). Loaded by name so this module builds before that export exists.
 */
async function catalogResolver(): Promise<VariantResolver | null> {
  const spec = '@ecomkit/catalog/server';
  try {
    const mod = (await import(/* @vite-ignore */ spec)) as { variantRefsBySku?: VariantResolver };
    return mod.variantRefsBySku ?? sqlResolver;
  } catch {
    return sqlResolver;
  }
}

// ponytail: seed-time read of catalog's tables (variant sku = product sku + suffix, catalog seed.ts:262)
// until catalog exports variantRefsBySku; without it no inventory_level rows were seeded and nothing was purchasable.
const sqlResolver: VariantResolver = async (skus) => {
  const r = await db.execute<{ sku: string; variant_id: string; product_id: string }>(
    sql`select p.sku || v.sku_suffix as sku, v.id as variant_id, v.product_id from catalog_variant v join catalog_product p on p.id = v.product_id where p.sku || v.sku_suffix in ${[...skus]}`,
  );
  return Object.fromEntries(r.rows.map((x) => [x.sku, { variantId: x.variant_id, productId: x.product_id }]));
};

export async function readSeedVariants(seedDir: string): Promise<{ sku: string; onHand: number; readyInDays: number | null; lowStockThreshold: number | null }[]> {
  const out: { sku: string; onHand: number; readyInDays: number | null; lowStockThreshold: number | null }[] = [];
  for (const file of ['products.json', 'inputs.json']) {
    let raw: string;
    try {
      // The ignore comments stop Turbopack from tracing the whole repo into the standalone output for this seed-time read.
      raw = await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ seedDir, file), 'utf8');
    } catch {
      continue;
    }
    for (const p of seedFile.parse(JSON.parse(raw)).records) {
      p.variants.forEach((v, i) => {
        out.push({
          sku: v.sku ?? `${p.sku}-${String(i + 1).padStart(2, '0')}`,
          onHand: Math.max(0, v.stock_qty ?? 0),
          readyInDays: v.ready_in_days ?? null,
          lowStockThreshold: v.low_stock_threshold ?? null,
        });
      });
    }
  }
  return out;
}

export async function runSeed(ctx: SeedContext, resolve: VariantResolver | null): Promise<SeedResult> {
  const variants = await readSeedVariants(ctx.seedDir);
  if (!variants.length) return { inserted: 0, updated: 0, skipped: 0, notes: ['no seed variants found'] };
  if (!resolve) return { inserted: 0, updated: 0, skipped: variants.length, notes: ['catalog variantRefsBySku is not available; levels not seeded'] };
  const refs = await resolve(variants.map((v) => v.sku));
  const rows: SeedLevel[] = [];
  const unknown: string[] = [];
  for (const v of variants) {
    const ref = refs[v.sku];
    if (ref) rows.push({ ...ref, sku: v.sku, onHand: v.onHand, readyInDays: v.readyInDays, lowStockThreshold: v.lowStockThreshold });
    else unknown.push(v.sku);
  }
  const notes = unknown.length ? [`${unknown.length} variant skus not in the catalog: ${unknown.slice(0, 10).join(', ')}`] : [];
  if (ctx.dryRun) return { inserted: 0, updated: 0, skipped: variants.length, notes: [...notes, `dry run: ${rows.length} levels would be checked`] };
  const r = await seedLevels(rows);
  return { inserted: r.inserted, updated: r.updated, skipped: r.skipped + unknown.length, notes };
}

export async function seedHook(ctx: SeedContext): Promise<SeedResult> {
  return runSeed(ctx, await catalogResolver());
}
