import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { z } from 'zod';
import { normalisePath } from '../domain';
import { seoRedirect } from '../schema';
import { addRedirect, RedirectError } from './redirects';

const recordSchema = z.object({
  from: z.string(),
  to_sku: z.string().nullable().optional(),
  to_path: z.string().nullable().optional(),
  code: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
  status: z.enum(['pending', 'active']),
});
const fileSchema = z.object({ records: z.array(recordSchema) });

/**
 * Seed hook `redirects`: legacy URLs from data/seed/redirects.json. Only `active` rows with a `to_path` are
 * imported here; `pending` rows and rows that name a product SKU wait for the catalog, which adds the redirect
 * when the product is published. Existing rows are never overwritten, so a second run changes nothing.
 */
export async function runSeed(ctx: SeedContext): Promise<SeedResult> {
  const file = join(ctx.seedDir, 'redirects.json');
  if (!existsSync(file)) return { inserted: 0, updated: 0, skipped: 0, notes: ['redirects.json not found'] };
  const { records } = fileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const existing = new Set((await db.select({ from: seoRedirect.fromPath }).from(seoRedirect)).map((r) => r.from));
  const result = { inserted: 0, updated: 0, skipped: 0, notes: [] as string[] };
  for (const r of records) {
    const from = normalisePath(r.from);
    if (r.status !== 'active' || !r.to_path || !from || existing.has(from)) {
      result.skipped++;
      continue;
    }
    if (ctx.dryRun) {
      result.inserted++;
      continue;
    }
    try {
      await addRedirect(from, r.to_path, { source: 'legacy_import', statusCode: r.code });
      existing.add(from);
      result.inserted++;
    } catch (err) {
      if (!(err instanceof RedirectError)) throw err;
      result.skipped++;
      result.notes.push(`${r.from}: ${err.reason}`);
    }
  }
  ctx.log.info('seo redirects seeded', { inserted: result.inserted, skipped: result.skipped });
  return result;
}
