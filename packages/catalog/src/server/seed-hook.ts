import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { importSeed } from './import';

/** seed:load hook: products, variants, collections, tags, FAQs (and media links when a resolver is bound). */
export async function runSeed(ctx: SeedContext): Promise<SeedResult> {
  return importSeed({ seedDir: ctx.seedDir, dryRun: ctx.dryRun, log: ctx.log });
}
