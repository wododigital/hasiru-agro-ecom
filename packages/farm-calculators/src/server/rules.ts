// Dosage rules: cached storefront read, fresh admin read, audited writes.
import { asc, eq } from 'drizzle-orm';
import { audit } from '@ecomkit/core/audit';
import { cacheFor, invalidateTags, tags } from '@ecomkit/core/cache-tags';
import { db, type DbOrTx } from '@ecomkit/core/db';
import { dosageRuleSchema, type DosageRule, type DosageRuleInput } from '../domain';
import { farmcalcDosageRule } from '../schema';

export const RULES_TAG = tags.settings('farm-calculators');
type Row = typeof farmcalcDosageRule.$inferSelect;

const toRule = (r: Row): DosageRule & { id: string } => ({
  id: r.id,
  inputProductId: r.inputProductId,
  basis: r.basis,
  role: r.role,
  ageBand: r.ageBand,
  amount: Number(r.amount),
  packSize: Number(r.packSize),
  unit: r.unit,
  minPacks: r.minPacks,
  usePlantCompost: r.usePlantCompost,
  isActive: r.isActive,
  position: r.position,
});

async function readRules(conn: DbOrTx = db) {
  const rows = await conn.select().from(farmcalcDosageRule).orderBy(asc(farmcalcDosageRule.position), asc(farmcalcDosageRule.inputProductId), asc(farmcalcDosageRule.id));
  return rows.map(toRule);
}

/** Every rule (active or not), for the storefront calculators. Refreshed by admin saves. */
export async function listDosageRules(): Promise<(DosageRule & { id: string })[]> {
  'use cache';
  cacheFor([RULES_TAG]);
  return readRules();
}

/** Uncached, for the admin page. */
export const listDosageRulesFresh = () => readRules();

export class DuplicateRuleError extends Error {
  constructor() {
    super('a rule for this input, basis, role and age already exists');
  }
}

/** Create (no id) or update a rule. One rule per input + basis + role + age band. */
export async function saveDosageRule(input: DosageRuleInput & { id?: string | null }, actorId: string | null): Promise<string> {
  const rule = dosageRuleSchema.parse(input);
  const values = { ...rule, updatedAt: new Date() };
  return db.transaction(async (tx) => {
    const [before] = input.id ? await tx.select().from(farmcalcDosageRule).where(eq(farmcalcDosageRule.id, input.id)).limit(1) : [];
    let id: string;
    try {
      if (before) {
        await tx.update(farmcalcDosageRule).set(values).where(eq(farmcalcDosageRule.id, before.id));
        id = before.id;
      } else {
        const [row] = await tx.insert(farmcalcDosageRule).values(values).returning({ id: farmcalcDosageRule.id });
        id = row!.id;
      }
    } catch (err) {
      if ((err as { cause?: { code?: string }; code?: string }).cause?.code === '23505' || (err as { code?: string }).code === '23505') throw new DuplicateRuleError();
      throw err;
    }
    await audit({ actorId, actorType: 'staff', action: before ? 'farmcalc.rule.update' : 'farmcalc.rule.create', entity: 'farmcalc_dosage_rule', entityId: id, before: before ? toRule(before) : null, after: rule }, { tx });
    return id;
  }).finally(() => invalidateTags([RULES_TAG]));
}

export async function deleteDosageRule(id: string, actorId: string | null): Promise<boolean> {
  const removed = await db.transaction(async (tx) => {
    const [before] = await tx.delete(farmcalcDosageRule).where(eq(farmcalcDosageRule.id, id)).returning();
    if (before) await audit({ actorId, actorType: 'staff', action: 'farmcalc.rule.delete', entity: 'farmcalc_dosage_rule', entityId: id, before: toRule(before), after: null }, { tx });
    return !!before;
  });
  await invalidateTags([RULES_TAG]);
  return removed;
}
