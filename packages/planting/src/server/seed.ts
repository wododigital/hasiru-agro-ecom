import 'server-only';
// Seed hook `planting`: data/seed/models.json (+ per-plant model spacing from products.json) -> models and members.
// Creates models that do not exist yet, with their members; an existing model belongs to the admin and is left alone,
// so a second run changes nothing and staff edits survive re-seeding.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { db, withTx } from '@ecomkit/core/db';
import { safeHtml } from '@ecomkit/core/validation';
import { z } from 'zod';
import { legendSchema, slugSchema, type Pattern, type Role, type SpacingValue } from '../domain';
import { plantingModel, plantingModelPlant } from '../schema';
import { plantingRuntime } from './runtime';

/** Default picks per role in seeded models (the first members by the client's sort order). */
const SEED_DEFAULT_PICKS = 3;

const roleSchema = z.enum(['M', 'X', 'O']);
const modelsFile = z.object({
  records: z.array(
    z.object({
      slug: slugSchema,
      name: z.string().min(1),
      description: z.string().nullish(),
      kind: z.enum(['area', 'line']),
      block_ft: z.object({ w: z.number().positive(), h: z.number().min(0) }),
      spacing_ft: z.object({ plant: z.number().positive(), row: z.number().min(0) }),
      pattern: z.array(z.string().regex(/^[MXO]+$/)),
      mix: z.object({ M: z.number(), X: z.number(), O: z.number() }).nullish(),
      rng_seed: z.number().int().nullish(),
      weight_override_kg: z.number().positive().nullish(),
      legend: legendSchema,
      members: z.array(z.object({ sku: z.string(), role: roleSchema, sort: z.number().int() })),
      sort: z.number().int().default(0),
    }),
  ),
});
const productsFile = z.object({
  records: z.array(z.object({ sku: z.string(), plant: z.object({ models: z.record(z.string(), z.object({ spacing_ft: z.unknown() }).nullable()).nullish() }).nullish() }).loose()),
});

type SeedModel = z.infer<typeof modelsFile>['records'][number];

function patternOf(m: SeedModel): Pattern {
  if (m.mix) return { kind: 'random', mix: m.mix, seed: m.rng_seed ?? null };
  if (m.kind === 'line') return { kind: 'line', rows: [m.pattern[0] ?? 'M'] };
  return { kind: 'rows', rows: m.pattern.length ? m.pattern : ['M'] };
}

const spacingOf = (v: unknown): SpacingValue | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n > 0) ? [v[0], v[1]] : typeof v === 'number' && v > 0 ? v : null;

async function readJson(dir: string, file: string): Promise<unknown | null> {
  try {
    // The ignore comments keep Turbopack from tracing the whole repository into the standalone output.
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, file), 'utf8'));
  } catch {
    return null;
  }
}

export async function runPlantingSeed(ctx: SeedContext, resolve = plantingRuntime().productIdsBySku): Promise<SeedResult> {
  const rawModels = await readJson(ctx.seedDir, 'models.json');
  if (!rawModels) return { inserted: 0, updated: 0, skipped: 0, notes: ['models.json not found'] };
  const models = modelsFile.parse(rawModels).records;
  const products = productsFile.safeParse((await readJson(ctx.seedDir, 'products.json')) ?? { records: [] });
  const spacing = new Map<string, Record<string, unknown>>();
  if (products.success) for (const p of products.data.records) if (p.plant?.models) spacing.set(p.sku, p.plant.models as Record<string, unknown>);

  const existing = new Set((await db.select({ slug: plantingModel.slug }).from(plantingModel)).map((r) => r.slug));
  const fresh = models.filter((m) => !existing.has(m.slug));
  const notes: string[] = [];
  if (!fresh.length) return { inserted: 0, updated: 0, skipped: models.length, notes };
  const skus = [...new Set(fresh.flatMap((m) => m.members.map((x) => x.sku)))];
  const ids = resolve ? await resolve(skus) : {};
  if (!resolve) notes.push('no productIdsBySku binding: models seeded without members');
  const unknown = skus.filter((s) => !ids[s]);
  if (resolve && unknown.length) notes.push(`${unknown.length} member skus not in the catalog: ${unknown.slice(0, 10).join(', ')}`);

  let inserted = 0;
  const planned = fresh.map((m) => {
    const picked: Record<Role, number> = { M: 0, X: 0, O: 0 };
    const members = [...m.members]
      .sort((a, b) => a.sort - b.sort)
      .flatMap((x) => {
        const productId = ids[x.sku];
        if (!productId) return [];
        const perModel = spacing.get(x.sku)?.[m.slug.replace(/-/g, '_')] as { spacing_ft?: unknown } | null | undefined;
        return [{ productId, role: x.role, position: x.sort, isDefaultPick: picked[x.role]++ < SEED_DEFAULT_PICKS, spacingFt: spacingOf(perModel?.spacing_ft) }];
      });
    return { m, members };
  });
  for (const { members } of planned) inserted += 1 + members.length;
  if (ctx.dryRun) return { inserted, updated: 0, skipped: models.length - fresh.length, notes: [...notes, 'dry run: nothing written'] };

  await withTx(async (tx) => {
    for (const { m, members } of planned) {
      const [row] = await tx
        .insert(plantingModel)
        .values({
          slug: m.slug,
          name: m.name,
          descriptionHtml: m.description ? safeHtml(`<p>${m.description}</p>`) : null,
          blockWFt: m.block_ft.w,
          blockHFt: m.kind === 'line' ? 0 : m.block_ft.h,
          colSpacingFt: m.spacing_ft.plant,
          rowSpacingFt: m.kind === 'line' ? 0 : m.spacing_ft.row,
          pattern: patternOf(m),
          legend: m.legend,
          weightOverrideKg: m.weight_override_kg ?? null,
          position: m.sort,
        })
        .returning({ id: plantingModel.id });
      if (members.length) await tx.insert(plantingModelPlant).values(members.map((x) => ({ ...x, modelId: row!.id })));
    }
  });
  return { inserted, updated: 0, skipped: models.length - fresh.length, notes };
}

