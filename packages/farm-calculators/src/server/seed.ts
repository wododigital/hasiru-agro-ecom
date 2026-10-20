// Seed hook: dosage rules from the dosage data the catalogue imported onto input products (product.dosageRules).
// Runs after the catalog seed (module dependency order). Idempotent: existing rules (and admin edits) are kept.
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { invalidateTags } from '@ecomkit/core/cache-tags';
import { db } from '@ecomkit/core/db';
import { getProduct, listProducts } from '@ecomkit/catalog/server';
import { dosageRuleSchema, SIZE_ROLE, type DosageRule } from '../domain';
import { farmcalcDosageRule } from '../schema';
import { RULES_TAG } from './rules';

/** One entry of a product's imported `dosage_rules` (data/seed inputs.json `input.dosage_rules`). */
interface SeedRule {
  basis?: string;
  role?: string | null;
  size_class?: string | null;
  qty?: number;
  unit?: string;
  note?: string;
}

/** "25 kg", "5 L" -> 25, 5. */
const packNumber = (packSize: string | null) => (packSize ? Number.parseFloat(packSize) : Number.NaN);

/** Pure mapping, exported for tests. per_block rules are derived from per_acre ones and are skipped. */
export function rulesFromProduct(productId: string, packSize: string | null, seedRules: readonly SeedRule[], position: number): { rules: DosageRule[]; notes: string[] } {
  const notes: string[] = [];
  const pack = packNumber(packSize);
  const rules: DosageRule[] = [];
  for (const r of seedRules) {
    if (r.basis !== 'per_plant' && r.basis !== 'per_acre') continue;
    const role = r.role ?? (r.size_class && r.size_class in SIZE_ROLE ? SIZE_ROLE[r.size_class as keyof typeof SIZE_ROLE] : 'any');
    const parsed = dosageRuleSchema.safeParse({
      inputProductId: productId,
      basis: r.basis,
      role,
      amount: r.qty,
      packSize: pack,
      unit: r.unit === 'L' ? 'L' : 'kg',
      minPacks: r.basis === 'per_acre' ? 1 : 0,
      // ponytail: the seed marks "use the plant's own compost figure" only in a note; an explicit flag in the seed data would replace this.
      usePlantCompost: /compost_kg/.test(r.note ?? ''),
      isActive: true,
      position,
    });
    if (parsed.success) rules.push(parsed.data);
    else notes.push(`input ${productId}: skipped a ${r.basis} rule (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  }
  return { rules, notes };
}

export async function seedDosageRules(ctx: SeedContext): Promise<SeedResult> {
  const { rows } = await listProducts({ kind: 'input', sort: 'name', limit: 1000 });
  const notes: string[] = [];
  const all: DosageRule[] = [];
  for (const [i, row] of rows.entries()) {
    const detail = await getProduct(row.slug);
    if (!detail) continue;
    const seedRules = (detail.product.dosageRules ?? []) as SeedRule[];
    const out = rulesFromProduct(detail.product.id, detail.product.packSize, seedRules, (i + 1) * 10);
    all.push(...out.rules);
    notes.push(...out.notes);
  }
  if (ctx.dryRun) return { inserted: 0, updated: 0, skipped: all.length, notes: [`dry run: ${all.length} rules found`, ...notes] };
  const inserted = all.length
    ? await db
        .insert(farmcalcDosageRule)
        .values(all)
        .onConflictDoNothing({ target: [farmcalcDosageRule.inputProductId, farmcalcDosageRule.basis, farmcalcDosageRule.role, farmcalcDosageRule.ageBand] })
        .returning({ id: farmcalcDosageRule.id })
    : [];
  if (inserted.length) await invalidateTags([RULES_TAG]);
  ctx.log.info('farm-calculators seed', { rules: all.length, inserted: inserted.length });
  return { inserted: inserted.length, updated: 0, skipped: all.length - inserted.length, notes };
}
