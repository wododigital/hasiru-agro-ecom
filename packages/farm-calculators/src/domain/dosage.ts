// Dosage rules and the recommended-inputs engine (compost calculator, planting packages, PDP mini-calculator).
import { z } from 'zod';
import type { Role } from '@ecomkit/core/contracts';

export const RULE_ROLES = ['M', 'X', 'O', 'any'] as const satisfies readonly (Role | 'any')[];
export type RuleRole = (typeof RULE_ROLES)[number];
export const AGE_BANDS = ['at_planting', 'y0_2', 'y3_6', 'y7_plus'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
/** per_plant: amount per plant of the role; per_acre: amount per acre of land (liquid feeds, cover-crop seed). */
export const BASES = ['per_plant', 'per_acre'] as const;
export type Basis = (typeof BASES)[number];
export const UNITS = ['kg', 'L'] as const;
export type Unit = (typeof UNITS)[number];

/** Size class to M/X/O role when only sizes are known (A12: large = main, medium = host, small = biomass). */
export const SIZE_ROLE = { L: 'M', M: 'X', S: 'O' } as const satisfies Record<string, Role>;
export type SizeClass = keyof typeof SIZE_ROLE;
export const SIZE_CLASSES = Object.keys(SIZE_ROLE) as SizeClass[];

const qty = z.coerce.number().min(0).max(100_000);
/** Checkbox semantics: present ('on', 'true', true) is true, anything else false. */
const flag = z.preprocess((v) => v === true || v === 'on' || v === 'true' || v === '1', z.boolean());

/** One row of farmcalc_dosage_rule as the admin edits it. */
export const dosageRuleSchema = z.object({
  inputProductId: z.uuid(),
  basis: z.enum(BASES).default('per_plant'),
  role: z.enum(RULE_ROLES).default('any'),
  ageBand: z.enum(AGE_BANDS).default('at_planting'),
  amount: qty,
  packSize: z.coerce.number().positive().max(100_000),
  unit: z.enum(UNITS).default('kg'),
  minPacks: z.coerce.number().int().min(0).max(1000).default(0),
  /** Per-plant amount comes from the plant's own compost figure for the age band when it has one. */
  usePlantCompost: flag,
  isActive: flag,
  position: z.coerce.number().int().min(0).max(10_000).default(0),
});
/** Checkbox fields may be left out (unchecked). */
export type DosageRuleInput = Omit<z.input<typeof dosageRuleSchema>, 'usePlantCompost' | 'isActive'> & { usePlantCompost?: unknown; isActive?: unknown };
export type DosageRule = z.output<typeof dosageRuleSchema> & { id?: string };

export interface PlantLine {
  qty: number;
  role: Role;
  /** The plant's own compost kg for the requested age band, when the catalogue has it. */
  compostKg?: number | null;
}

export interface InputNeed {
  inputProductId: string;
  /** Total kg or litres before rounding to packs. */
  amount: number;
  unit: Unit;
  packSize: number;
  packs: number;
}

/** ceil that ignores floating dust (0.1 + 0.2 style sums landing a hair above a whole pack). */
export function packsFor(amount: number, packSize: number, minPacks = 0): number {
  if (!(amount > 0) || !(packSize > 0)) return 0;
  return Math.max(minPacks, Math.ceil(amount / packSize - 1e-9));
}

function perPlantDose(rules: readonly DosageRule[], line: PlantLine): { rule: DosageRule; dose: number } | null {
  const rule = rules.find((r) => r.role === line.role) ?? rules.find((r) => r.role === 'any');
  if (!rule) return null;
  const own = rule.usePlantCompost && line.compostKg != null && line.compostKg >= 0 ? line.compostKg : null;
  return { rule, dose: own ?? rule.amount };
}

/**
 * Inputs for a set of plants on some land. Per input: per-plant rules sum `qty x dose(role)` (an exact role
 * rule wins over `any`), per-acre rules add `acres x amount`; packs = max(minPacks, ceil(amount / packSize)).
 * Only active rules of the requested age band count. Output follows rule order; inputs needing nothing are left out.
 * With the plan's default rules this is: vermicompost ceil(sum q x {2,1,0.5}[role] / 25), biochar
 * ceil(sum q x {1,0.5,0.25}[role] / 10), neem cake ceil(0.25 x plants / 25), liquid feed max(1, ceil(acres x 4)).
 */
export function recommendInputs(input: { plants: readonly PlantLine[]; acres: number; rules: readonly DosageRule[]; ageBand?: AgeBand }): InputNeed[] {
  const band = input.ageBand ?? 'at_planting';
  const byInput = new Map<string, DosageRule[]>();
  for (const r of [...input.rules].sort((a, b) => a.position - b.position)) {
    if (!r.isActive || r.ageBand !== band) continue;
    byInput.set(r.inputProductId, [...(byInput.get(r.inputProductId) ?? []), r]);
  }
  const acres = Math.max(0, input.acres);
  const out: InputNeed[] = [];
  for (const [inputProductId, rules] of byInput) {
    const plantRules = rules.filter((r) => r.basis === 'per_plant');
    const acreRules = rules.filter((r) => r.basis === 'per_acre');
    let amount = 0;
    for (const line of input.plants) {
      if (!(line.qty > 0)) continue;
      const hit = perPlantDose(plantRules, line);
      if (hit) amount += line.qty * hit.dose;
    }
    for (const r of acreRules) amount += acres * r.amount;
    const first = rules[0]!;
    const packSize = first.packSize;
    const minPacks = Math.max(...rules.map((r) => r.minPacks));
    const packs = packsFor(amount, packSize, minPacks);
    if (packs > 0) out.push({ inputProductId, amount: Math.round(amount * 1000) / 1000, unit: first.unit, packSize, packs });
  }
  return out;
}

/** Plant lines from counts by size class (the compost calculator's "Enter my own" mode). */
export function linesFromSizes(counts: Partial<Record<SizeClass, number>>): PlantLine[] {
  return SIZE_CLASSES.map((s) => ({ qty: Math.max(0, Math.floor(counts[s] ?? 0)), role: SIZE_ROLE[s] }));
}
