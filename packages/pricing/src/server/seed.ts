// Seed hook `pricing.prices`: data/seed/{products,inputs}.json variant prices -> pricing_price + bulk tier.
// Rupees in the seed, integer paise here. Existing rows are left alone (admin-owned after the first load).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { variantRefsBySku } from '@ecomkit/catalog/server';
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { z } from 'zod';
import { pricingPrice, pricingTier } from '../schema';

const rupees = z.number().nonnegative().nullish();
const seedFile = z.object({
  records: z.array(
    z.object({
      sku: z.string(),
      variants: z.array(z.object({ sku: z.string().optional(), price: rupees, compare_at_price: rupees, bulk_price: rupees, bulk_min_qty: z.number().int().nullish(), offline_price: rupees })),
    }),
  ),
});
const paise = (r: number | null | undefined) => (r == null ? null : Math.round(r * 100));

export async function seedHook(ctx: SeedContext): Promise<SeedResult> {
  const variants: (z.infer<typeof seedFile>['records'][number]['variants'][number] & { sku: string })[] = [];
  for (const file of ['products.json', 'inputs.json']) {
    let raw: string;
    try {
      raw = await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ ctx.seedDir, file), 'utf8');
    } catch {
      continue;
    }
    for (const p of seedFile.parse(JSON.parse(raw)).records) p.variants.forEach((v, i) => variants.push({ ...v, sku: v.sku ?? `${p.sku}-${String(i + 1).padStart(2, '0')}` }));
  }
  const refs = await variantRefsBySku(variants.map((v) => v.sku));
  const priced = variants.filter((v) => refs[v.sku] && v.price != null && v.price > 0);
  const notes = [`${variants.length - priced.length} variants without a catalog row or a price`];
  if (ctx.dryRun || !priced.length) return { inserted: 0, updated: 0, skipped: variants.length, notes };
  const inserted = await db
    .insert(pricingPrice)
    .values(
      priced.map((v) => {
        const price = paise(v.price)!;
        const compare = paise(v.compare_at_price);
        return { ...refs[v.sku]!, pricePaise: price, compareAtPaise: compare != null && compare > price ? compare : null, offlinePricePaise: paise(v.offline_price) };
      }),
    )
    .onConflictDoNothing()
    .returning({ variantId: pricingPrice.variantId });
  const fresh = new Set(inserted.map((r) => r.variantId));
  const tiers = priced.filter((v) => fresh.has(refs[v.sku]!.variantId) && v.bulk_price != null && (v.bulk_min_qty ?? 0) >= 2 && paise(v.bulk_price)! < paise(v.price)!);
  if (tiers.length) await db.insert(pricingTier).values(tiers.map((v) => ({ variantId: refs[v.sku]!.variantId, minQty: v.bulk_min_qty!, unitPricePaise: paise(v.bulk_price)! }))).onConflictDoNothing();
  return { inserted: inserted.length + tiers.length, updated: 0, skipped: variants.length - inserted.length, notes };
}
