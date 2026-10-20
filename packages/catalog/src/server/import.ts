import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { audit } from '@ecomkit/core/audit';
import { tags } from '@ecomkit/core/cache-tags';
import type { Logger, SeedResult } from '@ecomkit/core/contracts';
import { db, withTx, type Tx } from '@ecomkit/core/db';
import { slugify } from '@ecomkit/core/ids';
import { safeHtml } from '@ecomkit/core/validation';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { CSV_COLUMNS, fromCsvRow, toCsvCell } from '../domain/csv';
import { productFieldsSchema, type ProductFields, type VariantFields } from '../domain/product';
import {
  deriveCollections,
  mapSeedProduct,
  seedCollectionSchema,
  seedFaqSchema,
  seedProductSchema,
  faqStatusFromSeed,
  subcollectionSlug,
  type MappedSeedProduct,
  type SeedCollection,
} from '../domain/seed';
import { matchKey, parseSheetRow, SHEET_DATA_START, SHEET_HEADER, SHEET_MERGES, SHEET_NAME, toSheetRow, type SheetRow } from '../domain/sheet';
import { catalogCollection, catalogFaq, catalogProduct, catalogProductMedia, catalogProductTag, catalogTag, catalogVariant, type ProductRow } from '../schema';
import { expireTags } from '@ecomkit/core/cache-tags';
import { catalogRuntime } from './runtime';
import { saveProduct, type Actor } from './write';

// ---------------------------------------------------------------------------------------------------------------
// Seed import (data/seed -> catalog tables). Idempotent: every entity is compared before it is written, so a
// second run reports 0 inserted and 0 updated. Prices and stock in the records belong to pricing and inventory.

/** Stable JSON for change detection (object keys sorted, undefined dropped). */
function stable(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}
const same = (desired: Record<string, unknown>, row: Record<string, unknown>): boolean => Object.keys(desired).every((k) => stable(desired[k]) === stable(row[k]));

async function readEnvelope(file: string): Promise<unknown[] | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { records?: unknown };
    return Array.isArray(parsed.records) ? parsed.records : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export interface SeedImportOptions {
  seedDir: string;
  dryRun?: boolean;
  log?: Logger;
}

class DryRunRollback extends Error {}

type Counter = { inserted: number; updated: number; skipped: number };
const bump = (c: Counter, kind: 'inserted' | 'updated' | 'skipped') => void (c[kind] += 1);

async function upsertCollections(tx: Tx, list: readonly SeedCollection[], c: Counter): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  // Parents first so children can reference them.
  const ordered = [...list].sort((a, b) => Number(!!a.parent) - Number(!!b.parent));
  for (const col of ordered) {
    const parentId = col.parent ? (ids.get(col.parent) ?? null) : null;
    const desired = {
      slug: col.slug,
      name: col.name,
      nameKn: col.name_kn ?? null,
      kind: col.kind,
      parentId,
      position: col.position,
      introHtml: col.intro_html ? safeHtml(col.intro_html) : null,
      seoTitle: col.seo_title ?? null,
      seoDescription: col.seo_description ?? null,
    };
    const [row] = await tx.select().from(catalogCollection).where(eq(catalogCollection.slug, col.slug));
    if (!row) {
      const [ins] = await tx.insert(catalogCollection).values(desired).returning({ id: catalogCollection.id });
      ids.set(col.code, ins!.id);
      bump(c, 'inserted');
    } else {
      ids.set(col.code, row.id);
      if (same(desired, row)) bump(c, 'skipped');
      else {
        await tx.update(catalogCollection).set({ ...desired, updatedAt: new Date() }).where(eq(catalogCollection.id, row.id));
        bump(c, 'updated');
      }
    }
  }
  return ids;
}

function collectionFor(m: MappedSeedProduct, ids: ReadonlyMap<string, string>, list: readonly SeedCollection[]): string | null {
  if (m.subcategory) {
    const subSlug = subcollectionSlug(m.subcategory, slugify);
    const child = list.find((x) => x.parent === m.collectionCode && (x.slug === subSlug || x.name.toLowerCase() === m.subcategory!.toLowerCase()));
    if (child) return ids.get(child.code) ?? null;
  }
  const top = list.find((x) => x.code === m.collectionCode) ?? list.find((x) => x.slug === m.collectionCode);
  return top ? (ids.get(top.code) ?? null) : null;
}

async function syncSeedVariants(tx: Tx, productId: string, variants: readonly VariantFields[], c: Counter): Promise<void> {
  const existing = await tx.select().from(catalogVariant).where(eq(catalogVariant.productId, productId));
  for (const v of variants) {
    const desired = { label: v.label, isDefault: v.isDefault, heightFt: v.heightFt, bagSize: v.bagSize, weightKg: v.weightKg, position: v.position };
    const row = existing.find((e) => e.skuSuffix === v.skuSuffix);
    if (!row) {
      if (v.isDefault) await tx.update(catalogVariant).set({ isDefault: false }).where(eq(catalogVariant.productId, productId));
      await tx.insert(catalogVariant).values({ productId, skuSuffix: v.skuSuffix, ...desired });
      bump(c, 'inserted');
    } else if (!same(desired, row)) {
      if (v.isDefault && !row.isDefault) await tx.update(catalogVariant).set({ isDefault: false }).where(eq(catalogVariant.productId, productId));
      await tx.update(catalogVariant).set(desired).where(eq(catalogVariant.id, row.id));
      bump(c, 'updated');
    } else bump(c, 'skipped');
  }
}

async function syncSet<T>(current: readonly T[], wanted: readonly T[], key: (t: T) => string, write: () => Promise<void>, c: Counter): Promise<void> {
  const a = [...current].map(key).sort().join('|');
  const b = [...wanted].map(key).sort().join('|');
  if (a === b) return bump(c, 'skipped');
  await write();
  bump(c, current.length ? 'updated' : 'inserted');
}

/** Loads data/seed/{products,inputs}.json (+ optional collections.json, faqs.json) into the catalog tables. */
export async function importSeed(options: SeedImportOptions): Promise<SeedResult> {
  const notes: string[] = [];
  const c: Counter = { inserted: 0, updated: 0, skipped: 0 };
  const raw = [...((await readEnvelope(join(options.seedDir, 'products.json'))) ?? []), ...((await readEnvelope(join(options.seedDir, 'inputs.json'))) ?? [])];
  if (!raw.length) {
    notes.push('no products.json or inputs.json records found');
    return { ...c, notes };
  }
  const records = raw.flatMap((r, i) => {
    const parsed = seedProductSchema.safeParse(r);
    if (!parsed.success) {
      notes.push(`record ${i} (${(r as { sku?: string }).sku ?? '?'}) skipped: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
      return [];
    }
    return [parsed.data];
  });
  const mapped = records.flatMap((r) => {
    try {
      return [mapSeedProduct(r, slugify)];
    } catch (err) {
      notes.push(`${r.sku} skipped: ${String(err).slice(0, 200)}`);
      return [];
    }
  });
  const collectionRecords = (await readEnvelope(join(options.seedDir, 'collections.json')))?.map((x) => seedCollectionSchema.parse(x)) ?? deriveCollections(records, slugify);
  const faqRecords = (await readEnvelope(join(options.seedDir, 'faqs.json')))?.map((x) => seedFaqSchema.parse(x)) ?? [];
  const resolveMedia = catalogRuntime().resolveMediaIds;
  const mediaIds = resolveMedia ? await resolveMedia([...new Set(mapped.flatMap((m) => m.images.map((i) => i.src)))]) : null;
  if (!resolveMedia) notes.push('media links skipped: no media resolver bound (configureCatalog({ resolveMediaIds }))');

  const run = async (tx: Tx) => {
    const collectionIds = await upsertCollections(tx, collectionRecords, c);

    const tagIds = new Map<string, string>();
    for (const t of new Map(mapped.flatMap((m) => m.tags.map((x) => [x.slug, x] as const))).values()) {
      const [row] = await tx.select().from(catalogTag).where(eq(catalogTag.slug, t.slug));
      if (!row) {
        const [ins] = await tx.insert(catalogTag).values({ slug: t.slug, name: t.name, kind: t.kind }).returning({ id: catalogTag.id });
        tagIds.set(t.slug, ins!.id);
        bump(c, 'inserted');
      } else {
        tagIds.set(t.slug, row.id);
        bump(c, 'skipped'); // tag names and kinds are admin-owned after the first load
      }
    }

    const productIds = new Map<string, string>();
    for (const m of mapped) {
      const desired = {
        ...m.fields,
        collectionId: collectionFor(m, collectionIds, collectionRecords),
        descriptionHtml: m.fields.descriptionHtml ? safeHtml(m.fields.descriptionHtml) : null,
        careHtml: m.fields.careHtml ? safeHtml(m.fields.careHtml) : null,
      };
      const [row] = await tx.select().from(catalogProduct).where(eq(catalogProduct.sku, m.fields.sku));
      let id: string;
      if (!row) {
        const [ins] = await tx
          .insert(catalogProduct)
          .values({ ...desired, publishedAt: desired.status === 'active' ? new Date() : null })
          .returning({ id: catalogProduct.id });
        id = ins!.id;
        bump(c, 'inserted');
      } else {
        id = row.id;
        if (same(desired, row)) bump(c, 'skipped');
        else {
          await tx
            .update(catalogProduct)
            .set({ ...desired, publishedAt: row.publishedAt ?? (desired.status === 'active' ? new Date() : null), updatedAt: new Date() })
            .where(eq(catalogProduct.id, row.id));
          bump(c, 'updated');
        }
      }
      productIds.set(m.fields.sku, id);
      await syncSeedVariants(tx, id, m.variants, c);

      const wantTags = m.tags.map((t) => tagIds.get(t.slug)!).filter(Boolean);
      const haveTags = (await tx.select({ id: catalogProductTag.tagId }).from(catalogProductTag).where(eq(catalogProductTag.productId, id))).map((r) => r.id);
      await syncSet(
        haveTags,
        wantTags,
        (x) => x,
        async () => {
          await tx.delete(catalogProductTag).where(eq(catalogProductTag.productId, id));
          if (wantTags.length) await tx.insert(catalogProductTag).values(wantTags.map((tagId) => ({ productId: id, tagId })));
        },
        c,
      );

      if (mediaIds) {
        const want = m.images.flatMap((img) => (mediaIds[img.src] ? [{ productId: id, mediaId: mediaIds[img.src]!, role: img.role, position: img.position }] : []));
        const unique = [...new Map(want.map((w) => [w.mediaId, w])).values()];
        const have = await tx.select().from(catalogProductMedia).where(eq(catalogProductMedia.productId, id));
        await syncSet(
          have,
          unique,
          (x) => `${x.mediaId}:${x.role}:${x.position}`,
          async () => {
            await tx.delete(catalogProductMedia).where(eq(catalogProductMedia.productId, id));
            if (unique.length) await tx.insert(catalogProductMedia).values(unique);
          },
          c,
        );
      }
    }

    // Product-embedded FAQs, then faqs.json (general and per product). Keys are the natural key.
    const faqs = [
      ...mapped.flatMap((m) => m.faqs.map((f) => ({ ...f, productId: productIds.get(m.fields.sku) ?? null }))),
      ...faqRecords.map((f) => ({
        key: f.key,
        productId: f.product_sku ? (productIds.get(f.product_sku) ?? null) : null,
        question: f.question,
        answerHtml: f.answer ? safeHtml(`<p>${f.answer.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`) : null,
        status: faqStatusFromSeed(f.status, f.source),
        source: f.source ?? null,
        position: f.sort,
      })),
    ];
    for (const f of faqs) {
      const desired = { productId: f.productId, question: f.question, answerHtml: f.answerHtml ? safeHtml(f.answerHtml) : null, status: f.status, source: f.source, position: f.position };
      const [row] = await tx.select().from(catalogFaq).where(eq(catalogFaq.key, f.key));
      if (!row) {
        await tx.insert(catalogFaq).values({ key: f.key, ...desired });
        bump(c, 'inserted');
      } else if (!same(desired, row)) {
        await tx.update(catalogFaq).set({ ...desired, updatedAt: new Date() }).where(eq(catalogFaq.id, row.id));
        bump(c, 'updated');
      } else bump(c, 'skipped');
    }
  };

  try {
    await withTx(async (tx) => {
      await run(tx);
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
    notes.push('dry run: rolled back');
  }
  if (!options.dryRun && c.inserted + c.updated > 0) await expireTags([tags.catalog]);
  options.log?.info('catalog seed import', { ...c });
  return { ...c, notes };
}

// ---------------------------------------------------------------------------------------------------------------
// Admin import/export: the grower's "Plant data" sheet (agronomy columns) and the flat CSV (every field).

export interface ImportReport {
  created: number;
  updated: number;
  unchanged: number;
  errors: { row: number; message: string }[];
}

const FIELD_KEYS = Object.keys(productFieldsSchema.shape) as (keyof ProductFields)[];

/** A stored product as form/import input (every editable field). */
export function rowToFields(row: ProductRow): ProductFields {
  const out: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) out[k] = (row as Record<string, unknown>)[k];
  return productFieldsSchema.parse(out);
}

async function existingVariants(productId: string): Promise<VariantFields[]> {
  const rows = await db.select().from(catalogVariant).where(eq(catalogVariant.productId, productId)).orderBy(asc(catalogVariant.position));
  return rows.map((v) => ({ id: v.id, label: v.label, skuSuffix: v.skuSuffix, isDefault: v.isDefault, heightFt: v.heightFt, bagSize: v.bagSize, weightKg: v.weightKg, position: v.position }));
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || 'product';
  const taken = new Set((await db.select({ slug: catalogProduct.slug }).from(catalogProduct)).map((r) => r.slug));
  let slug = root;
  for (let i = 2; taken.has(slug); i++) slug = `${root}-${i}`;
  return slug;
}

const changed = (a: ProductFields, b: ProductFields) => FIELD_KEYS.some((k) => stable(a[k]) !== stable(b[k]));

/** Agronomy columns a sheet row sets. Base name and variety are the match key, so they are only written on create. */
function sheetFields(r: SheetRow): Partial<ProductFields> {
  return {
    nameKn: r.nameKn,
    canopy: r.canopy,
    sizeClass: r.sizeClass,
    nitrogenFixer: r.nitrogenFixer,
    droughtTolerance: r.droughtTolerance,
    propagation: r.propagation,
    tempOpt: r.tempOpt,
    tempMin: r.tempMin,
    tempMax: r.tempMax,
    humidityOpt: r.humidityOpt,
    humidityMin: r.humidityMin,
    humidityMax: r.humidityMax,
    rainfallMin: r.rainfallMin == null ? null : Math.round(r.rainfallMin),
    rainfallMax: r.rainfallMax == null ? null : Math.round(r.rainfallMax),
    spacingFt: r.spacingFt,
    compostKg: r.compostKg,
  };
}

/**
 * Imports the "Plant data" sheet: rows match products by variety + base name (or name / search alias) and update
 * the agronomy columns through saveProduct (audit, events, cache). Unmatched rows become drafts flagged for review.
 */
export async function importSheet(data: ArrayBuffer | Uint8Array, actor: Actor): Promise<ImportReport> {
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[SHEET_NAME] ?? wb.Sheets[wb.SheetNames.find((n) => n.trim() === SHEET_NAME) ?? wb.SheetNames[0]!];
  if (!sheet) return { created: 0, updated: 0, unchanged: 0, errors: [{ row: 0, message: 'no sheet found' }] };
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null, raw: true });
  const products = await db.select().from(catalogProduct).where(and(eq(catalogProduct.kind, 'plant'), isNull(catalogProduct.deletedAt)));
  const index = new Map<string, ProductRow>();
  for (const p of products) {
    for (const k of [matchKey(p.baseName, p.variety), matchKey(p.name, null), ...p.searchAliases.map((a) => matchKey(a, null))]) if (k && !index.has(k)) index.set(k, p);
  }
  const report: ImportReport = { created: 0, updated: 0, unchanged: 0, errors: [] };
  for (let i = SHEET_DATA_START; i < rows.length; i++) {
    const parsed = parseSheetRow(rows[i] ?? []);
    if (!parsed) continue;
    try {
      const match = index.get(matchKey(parsed.baseName, parsed.variety));
      if (match) {
        const before = rowToFields(match);
        const next = productFieldsSchema.parse({ ...before, ...sheetFields(parsed) });
        if (!changed(before, next)) {
          report.unchanged++;
          continue;
        }
        await saveProduct({ id: match.id, fields: next, variants: await existingVariants(match.id) }, actor);
        report.updated++;
      } else {
        const name = [parsed.variety, parsed.baseName].filter(Boolean).join(' ');
        const slug = await uniqueSlug(name);
        const fields = productFieldsSchema.parse({
          ...sheetFields(parsed),
          baseName: parsed.baseName,
          variety: parsed.variety,
          sku: slug.toUpperCase().slice(0, 64),
          kind: 'plant',
          slug,
          name,
          subcategory: parsed.categories[0] ?? null,
          status: 'draft',
          needsReview: true,
          reviewNotes: ['Created by a sheet import: set the collection, price and content before publishing.'],
        });
        await saveProduct({ id: null, fields, variants: [] }, actor);
        report.created++;
      }
    } catch (err) {
      report.errors.push({ row: i + 1, message: String(err instanceof Error ? err.message : err).slice(0, 300) });
    }
  }
  await audit({ actorId: actor.actorId, actorType: actor.actorType, action: 'catalog.import_sheet', entity: 'catalog_product', entityId: 'import', after: report });
  return report;
}

/**
 * Imports the flat CSV (this module's export) or a previous store's product export (matched on legacy sku).
 * Only the columns present are changed; a row with an unknown sku creates a product when it has kind, slug and name.
 */
export async function importCsv(text: string, actor: Actor): Promise<ImportReport> {
  const wb = XLSX.read(text, { type: 'string', raw: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!, { defval: null, raw: false });
  const report: ImportReport = { created: 0, updated: 0, unchanged: 0, errors: [] };
  for (const [i, raw] of rows.entries()) {
    const patch = fromCsvRow(raw);
    try {
      const bySku = typeof patch.sku === 'string' && patch.sku ? await db.select().from(catalogProduct).where(eq(catalogProduct.sku, patch.sku)) : [];
      const byLegacy = !bySku.length && typeof patch.legacySku === 'string' && patch.legacySku ? await db.select().from(catalogProduct).where(eq(catalogProduct.legacySku, patch.legacySku)) : [];
      const match = bySku[0] ?? byLegacy[0];
      if (match) {
        const before = rowToFields(match);
        const next = productFieldsSchema.parse({ ...before, ...patch, sku: match.sku });
        if (!changed(before, next)) {
          report.unchanged++;
          continue;
        }
        await saveProduct({ id: match.id, fields: next, variants: await existingVariants(match.id) }, actor);
        report.updated++;
      } else {
        const fields = productFieldsSchema.parse({ status: 'draft', ...patch });
        await saveProduct({ id: null, fields, variants: [] }, actor);
        report.created++;
      }
    } catch (err) {
      const message = err instanceof Error && 'issues' in err ? (err as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') : String(err);
      report.errors.push({ row: i + 2, message: message.slice(0, 300) });
    }
  }
  await audit({ actorId: actor.actorId, actorType: actor.actorType, action: 'catalog.import_csv', entity: 'catalog_product', entityId: 'import', after: report });
  return report;
}

async function exportProducts(kind?: 'plant' | 'input') {
  return db
    .select()
    .from(catalogProduct)
    .where(and(isNull(catalogProduct.deletedAt), kind ? eq(catalogProduct.kind, kind) : undefined))
    .orderBy(asc(catalogProduct.sku));
}

/** The "Plant data" sheet for every plant (round-trips through importSheet). */
export async function exportSheet(): Promise<Uint8Array> {
  const products = await exportProducts('plant');
  const tagRows = products.length
    ? await db
        .select({ productId: catalogProductTag.productId, name: catalogTag.name })
        .from(catalogProductTag)
        .innerJoin(catalogTag, eq(catalogTag.id, catalogProductTag.tagId))
        .where(and(inArray(catalogProductTag.productId, products.map((p) => p.id)), eq(catalogTag.kind, 'use')))
        .orderBy(asc(catalogTag.name))
    : [];
  const rows = products.map((p, i) =>
    toSheetRow(
      {
        baseName: p.baseName ?? p.name,
        variety: p.variety,
        nameKn: p.nameKn,
        canopy: p.canopy,
        sizeClass: p.sizeClass,
        categories: [p.subcategory, ...tagRows.filter((t) => t.productId === p.id).map((t) => t.name)].filter((x): x is string => !!x).slice(0, 3),
        nitrogenFixer: p.nitrogenFixer,
        droughtTolerance: p.droughtTolerance,
        propagation: p.propagation,
        tempOpt: p.tempOpt,
        tempMin: p.tempMin,
        tempMax: p.tempMax,
        humidityOpt: p.humidityOpt,
        humidityMin: p.humidityMin,
        humidityMax: p.humidityMax,
        rainfallMin: p.rainfallMin,
        rainfallMax: p.rainfallMax,
        spacingFt: p.spacingFt,
        compostKg: p.compostKg ?? { at_planting: null, y0_2: null, y3_6: null, y7_plus: null },
      },
      i,
    ),
  );
  const ws = XLSX.utils.aoa_to_sheet([...SHEET_HEADER.map((r) => [...r]), ...rows]);
  ws['!merges'] = SHEET_MERGES;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array;
}

/** Every product as flat CSV (round-trips through importCsv). */
export async function exportCsv(): Promise<string> {
  const products = await exportProducts();
  const ws = XLSX.utils.aoa_to_sheet([CSV_COLUMNS.map(([h]) => h), ...products.map((p) => CSV_COLUMNS.map(([, field]) => toCsvCell(field, (p as Record<string, unknown>)[field])))]);
  return XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' });
}
