import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { audit } from '@ecomkit/core/audit';
import { requirePermission } from '@ecomkit/core/auth-context';
import { expireTags, tags } from '@ecomkit/core/cache-tags';
import { db, withTx, type DbOrTx } from '@ecomkit/core/db';
import { safeHtml } from '@ecomkit/core/validation';
import { memberFieldsSchema, modelFieldsSchema, type ModelWithMembers, type Pattern } from '../domain';
import { plantingModel, plantingModelPlant, type MemberRow, type ModelRow } from '../schema';

export const ALL_MODELS_TAG = tags.model('all');

export function toModel(row: ModelRow, members: readonly MemberRow[]): ModelWithMembers {
  return {
    slug: row.slug,
    name: row.name,
    nameKn: row.nameKn,
    descriptionHtml: row.descriptionHtml,
    blockFt: { w: row.blockWFt, h: row.blockHFt },
    spacingFt: { plant: row.colSpacingFt, row: row.rowSpacingFt },
    pattern: row.pattern,
    legend: row.legend,
    weightOverrideKg: row.weightOverrideKg,
    position: row.position,
    isActive: row.isActive,
    members: members
      .filter((m) => m.modelId === row.id)
      .sort((a, b) => a.position - b.position || a.productId.localeCompare(b.productId))
      .map((m) => ({ productId: m.productId, role: m.role, spacingFt: m.spacingFt, position: m.position, isDefaultPick: m.isDefaultPick })),
  };
}

/** Models with their members, in admin order. Uncached: callers on storefront routes use the cached reads. */
export async function loadModels(options: { activeOnly?: boolean; dbx?: DbOrTx } = {}): Promise<ModelWithMembers[]> {
  const x = options.dbx ?? db;
  const [rows, members] = await Promise.all([
    x
      .select()
      .from(plantingModel)
      .where(options.activeOnly ? eq(plantingModel.isActive, true) : undefined)
      .orderBy(asc(plantingModel.position), asc(plantingModel.slug)),
    x.select().from(plantingModelPlant),
  ]);
  return rows.map((r) => toModel(r, members));
}

export async function loadModel(slug: string, dbx: DbOrTx = db): Promise<ModelWithMembers | null> {
  const [row] = await dbx.select().from(plantingModel).where(eq(plantingModel.slug, slug)).limit(1);
  if (!row) return null;
  return toModel(row, await dbx.select().from(plantingModelPlant).where(eq(plantingModelPlant.modelId, row.id)));
}

// ---- admin writes (products.write) --------------------------------------------

export interface Actor {
  actorId: string | null;
}

async function staffActor(): Promise<Actor> {
  const v = await requirePermission('products.write');
  return { actorId: v.userId };
}

const geometry = (pattern: Pattern, col: number, row: number) =>
  pattern.kind === 'line' ? { blockHFt: 0, colSpacingFt: col, rowSpacingFt: 0 } : { blockHFt: 36, colSpacingFt: col, rowSpacingFt: pattern.kind === 'random' ? row || col : row };

/** Create or update a model by slug. Line patterns force a 0 ft block height; area patterns need a row spacing. */
export async function saveModel(raw: unknown): Promise<{ slug: string; created: boolean }> {
  const { actorId } = await staffActor();
  const f = modelFieldsSchema.parse(raw);
  if (f.pattern.kind === 'rows' && f.rowSpacingFt <= 0) throw new RangeError('row spacing must be above 0 for area models');
  const values = {
    name: f.name,
    nameKn: f.nameKn,
    descriptionHtml: f.descriptionHtml ? safeHtml(f.descriptionHtml) : null,
    blockWFt: 36,
    ...geometry(f.pattern, f.colSpacingFt, f.rowSpacingFt),
    pattern: f.pattern,
    legend: f.legend,
    weightOverrideKg: f.weightOverrideKg,
    position: f.position,
    isActive: f.isActive,
    updatedAt: new Date(),
  };
  const result = await withTx(async (tx) => {
    const [before] = await tx.select().from(plantingModel).where(eq(plantingModel.slug, f.slug)).limit(1);
    if (before) await tx.update(plantingModel).set(values).where(eq(plantingModel.id, before.id));
    else await tx.insert(plantingModel).values({ slug: f.slug, ...values });
    await audit({ actorId, actorType: 'staff', action: before ? 'planting.model.update' : 'planting.model.create', entity: 'planting_model', entityId: f.slug, before: before ?? null, after: values }, { tx });
    return { slug: f.slug, created: !before };
  });
  await expireTags([tags.model(f.slug), ALL_MODELS_TAG]);
  return result;
}

/** Adds a plant to a model or changes its role, position, default pick or spacing. */
export async function saveMember(raw: unknown): Promise<void> {
  const { actorId } = await staffActor();
  const f = memberFieldsSchema.parse(raw);
  await withTx(async (tx) => {
    const [model] = await tx.select({ id: plantingModel.id }).from(plantingModel).where(eq(plantingModel.slug, f.model)).limit(1);
    if (!model) throw new RangeError('unknown model');
    const values = { role: f.role, position: f.position, isDefaultPick: f.isDefaultPick, spacingFt: f.spacingFt };
    await tx
      .insert(plantingModelPlant)
      .values({ modelId: model.id, productId: f.productId, ...values })
      .onConflictDoUpdate({ target: [plantingModelPlant.modelId, plantingModelPlant.productId], set: values });
    await audit({ actorId, actorType: 'staff', action: 'planting.member.save', entity: 'planting_model', entityId: f.model, after: { productId: f.productId, ...values } }, { tx });
  });
  await expireTags([tags.model(f.model), ALL_MODELS_TAG]);
}

export async function removeMember(input: { model: string; productId: string }): Promise<boolean> {
  const { actorId } = await staffActor();
  const f = memberFieldsSchema.pick({ model: true, productId: true }).parse(input);
  const removed = await withTx(async (tx) => {
    const [model] = await tx.select({ id: plantingModel.id }).from(plantingModel).where(eq(plantingModel.slug, f.model)).limit(1);
    if (!model) return false;
    const gone = await tx
      .delete(plantingModelPlant)
      .where(and(eq(plantingModelPlant.modelId, model.id), eq(plantingModelPlant.productId, f.productId)))
      .returning({ productId: plantingModelPlant.productId });
    if (gone.length) await audit({ actorId, actorType: 'staff', action: 'planting.member.remove', entity: 'planting_model', entityId: f.model, before: { productId: f.productId } }, { tx });
    return gone.length > 0;
  });
  await expireTags([tags.model(f.model), ALL_MODELS_TAG]);
  return removed;
}
