// Seed hook `inventory.levels`: data/seed/{products,inputs}.json variants -> inventory_level (source `seed`, A26).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
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
    return mod.variantRefsBySku ?? null;
  } catch {
    return null;
  }
}

export async function readSeedVariants(seedDir: string): Promise<{ sku: string; onHand: number; readyInDays: number | null; lowStockThreshold: number | null }[]> {
  const out: { sku: string; onHand: number; readyInDays: number | null; lowStockThreshold: number | null }[] = [];
  for (const file of ['products.json', 'inputs.json']) {
    let raw: string;
    try {
      raw = await readFile(join(seedDir, file), 'utf8');
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
