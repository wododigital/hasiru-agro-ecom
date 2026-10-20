// Data for the calculators and the public recommended-inputs API other modules (planting, assistant, PDP) call.
import { cacheFor, tags } from '@ecomkit/core/cache-tags';
import type { PriceBook } from '@ecomkit/pricing/domain';
import { recommendInputs, type AgeBand, type CalcPlant, type DosageRule, type InputNeed, type PlantLine } from '../domain';
import { booksFor, loadCalculatorPlants, loadInputs } from './catalog-source';
import { listDosageRules, RULES_TAG } from './rules';

export interface PlantCalculatorData {
  plants: CalcPlant[];
  /** Keyed by variant id. */
  books: Record<string, PriceBook>;
}

/** Plants with spacing and their price books. Prices refresh hourly (the cart always re-prices). */
export async function plantCalculatorData(): Promise<PlantCalculatorData> {
  'use cache';
  cacheFor([tags.catalog], 'hours');
  const plants = await loadCalculatorPlants();
  return { plants, books: await booksFor(plants.map((p) => p.variantId)) };
}

export interface CalcInput {
  id: string;
  name: string;
  variantId: string | null;
}

export interface CompostCalculatorData {
  /** Active per-plant rules of inputs that are on sale. */
  rules: DosageRule[];
  inputs: CalcInput[];
  books: Record<string, PriceBook>;
}

/** Rules and the input products they point at (rules of hidden inputs are dropped). */
export async function compostCalculatorData(): Promise<CompostCalculatorData> {
  'use cache';
  cacheFor([tags.catalog, RULES_TAG], 'hours');
  const all = (await listDosageRules()).filter((r) => r.isActive && r.basis === 'per_plant');
  const inputs = await loadInputs(all.map((r) => r.inputProductId));
  const rules = all.filter((r) => inputs.has(r.inputProductId));
  const list = [...inputs.values()].map(({ id, name, variantId }) => ({ id, name, variantId }));
  return { rules, inputs: list, books: await booksFor(list.map((i) => i.variantId)) };
}

export interface RecommendedInput extends InputNeed {
  name: string;
  slug: string;
  variantId: string | null;
}

/**
 * The dosage contract for other modules: inputs for a planting, in full packs. `plants` carry the M/X/O role the
 * caller assigned (planting knows each plant's role per model) and optionally the plant's own compost kg.
 * Inputs that are hidden in the catalogue are left out.
 */
export async function recommendedInputs(input: { plants: readonly PlantLine[]; acres: number; ageBand?: AgeBand }): Promise<RecommendedInput[]> {
  const needs = recommendInputs({ ...input, rules: await listDosageRules() });
  const info = await loadInputs(needs.map((n) => n.inputProductId));
  return needs.flatMap((n) => {
    const i = info.get(n.inputProductId);
    return i ? [{ ...n, name: i.name, slug: i.slug, variantId: i.variantId }] : [];
  });
}
