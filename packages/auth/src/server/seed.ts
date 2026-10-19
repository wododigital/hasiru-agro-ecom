import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { ensureRolePermissions } from './staff';

/** Seed hook `auth.role-permissions`: the default role matrix for roles that have none. A second run inserts nothing. */
export async function seedRolePermissions(ctx: SeedContext): Promise<SeedResult> {
  const inserted = await ensureRolePermissions({ dryRun: ctx.dryRun });
  ctx.log.info('auth role matrix', { inserted });
  return { inserted, updated: 0, skipped: 0 };
}
