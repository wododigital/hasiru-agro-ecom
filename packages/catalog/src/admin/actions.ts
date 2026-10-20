'use server';

import { ForbiddenError, NotFoundError, requirePermission } from '@ecomkit/core/auth-context';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rowToFields } from '../server/import';
import { getProductForEdit } from '../server/admin-queries';
import { importCsv, importSheet } from '../server/import';
import {
  collectionFieldsSchema,
  deleteCollection,
  deleteFaq,
  deleteProduct,
  deleteTag,
  faqFieldsSchema,
  saveCollection,
  saveFaq,
  saveProduct,
  saveTag,
  setProductStatus,
  tagFieldsSchema,
  type Actor,
} from '../server/write';
import type { FormState } from './form-state';
import { fieldErrors, readProductForm, readVariants } from './parse';
import type { VariantFields } from '../domain/product';

async function staff(permission: 'products.read' | 'products.write'): Promise<Actor> {
  const viewer = await requirePermission(permission);
  return { actorId: viewer.userId, actorType: 'staff' };
}

function failure(err: unknown): FormState {
  if (err instanceof ForbiddenError) return { ok: false, message: 'You do not have permission to do that.' };
  if (err instanceof NotFoundError) return { ok: false, message: 'That record no longer exists.' };
  const text = String(err instanceof Error ? err.message : err);
  if (/duplicate key|unique/i.test(text)) return { ok: false, message: 'Another record already uses that slug or SKU.' };
  if (/violates foreign key/i.test(text)) return { ok: false, message: 'Still in use: move its products first.' };
  return { ok: false, message: text.slice(0, 200) };
}

const idOf = (fd: FormData) => {
  const v = fd.get('id');
  return typeof v === 'string' && v ? v : null;
};

/** One product form section (Details, Plant data, Content, Variants, Provenance). Creating redirects to the editor. */
export async function saveProductAction(_prev: FormState, fd: FormData): Promise<FormState> {
  let created: string | null = null;
  try {
    const actor = await staff('products.write');
    const id = idOf(fd);
    const existing = id ? await getProductForEdit(id) : null;
    if (id && !existing) throw new NotFoundError();
    const fields = readProductForm(fd, existing ? rowToFields(existing.product) : null);
    if (!fields.success) return { ok: false, message: 'Check the highlighted fields.', fieldErrors: fieldErrors(fields.error) };
    let variants: VariantFields[] = existing?.variants.map((v) => ({ id: v.id, label: v.label, skuSuffix: v.skuSuffix, isDefault: v.isDefault, heightFt: v.heightFt, bagSize: v.bagSize, weightKg: v.weightKg, position: v.position })) ?? [];
    if (fd.get('_variants')) {
      const read = readVariants(fd);
      if (!read.ok) return { ok: false, message: 'Check the variant rows.', fieldErrors: fieldErrors(read.error) };
      variants = read.variants;
    }
    const tagIds = fd.get('_tags') ? fd.getAll('tagIds').map(String) : undefined;
    const secondaryCollectionIds = fd.get('_tags') ? fd.getAll('secondaryCollectionIds').map(String) : undefined;
    const saved = await saveProduct({ id, fields: fields.data, variants, tagIds, secondaryCollectionIds }, actor);
    if (!id) created = saved.id;
  } catch (err) {
    return failure(err);
  }
  if (created) redirect(`/admin/products/${created}?created=1`);
  return { ok: true, message: 'Saved.' };
}

export async function deleteProductAction(fd: FormData): Promise<void> {
  const actor = await staff('products.write');
  const id = idOf(fd);
  const kind = fd.get('kind') === 'input' ? 'inputs' : 'products';
  if (id) await deleteProduct(id, actor);
  redirect(`/admin/${kind}`);
}

export async function saveCollectionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const actor = await staff('products.write');
    const parsed = collectionFieldsSchema.safeParse(Object.fromEntries(fd.entries()));
    if (!parsed.success) return { ok: false, message: 'Check the highlighted fields.', fieldErrors: fieldErrors(parsed.error) };
    await saveCollection(parsed.data, actor);
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteCollectionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const actor = await staff('products.write');
    const id = idOf(fd);
    if (id) await deleteCollection(id, actor);
    return { ok: true, message: 'Deleted.' };
  } catch (err) {
    return failure(err);
  }
}

export async function saveTagAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const actor = await staff('products.write');
    const parsed = tagFieldsSchema.safeParse(Object.fromEntries(fd.entries()));
    if (!parsed.success) return { ok: false, message: 'Check the highlighted fields.', fieldErrors: fieldErrors(parsed.error) };
    await saveTag(parsed.data, actor);
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteTagAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const actor = await staff('products.write');
    const id = idOf(fd);
    if (id) await deleteTag(id, actor);
    return { ok: true, message: 'Deleted.' };
  } catch (err) {
    return failure(err);
  }
}

export async function saveFaqAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const actor = await staff('products.write');
    const parsed = faqFieldsSchema.safeParse(Object.fromEntries(fd.entries()));
    if (!parsed.success) return { ok: false, message: 'Check the highlighted fields.', fieldErrors: fieldErrors(parsed.error) };
    await saveFaq(parsed.data, actor);
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteFaqAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const actor = await staff('products.write');
    const id = idOf(fd);
    if (id) await deleteFaq(id, actor);
    return { ok: true, message: 'Deleted.' };
  } catch (err) {
    return failure(err);
  }
}

const MAX_UPLOAD = 5 * 1024 * 1024;

/** Upload: the grower's sheet (.xlsx) or the flat CSV. */
export async function importAction(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const actor = await staff('products.write');
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a file to import.' };
    if (file.size > MAX_UPLOAD) return { ok: false, message: 'The file is larger than 5 MB.' };
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    const report = isCsv ? await importCsv(await file.text(), actor) : await importSheet(new Uint8Array(await file.arrayBuffer()), actor);
    return { ok: report.errors.length === 0, message: `${report.created} created, ${report.updated} updated, ${report.unchanged} unchanged, ${report.errors.length} errors.`, report };
  } catch (err) {
    return failure(err);
  }
}

/**
 * Bulk status from the products index (row checkboxes), bound per list: `bulkStatusAction.bind(null, base, status)`.
 * Bound arguments come from the client, so both are checked here.
 */
export async function bulkStatusAction(base: string, status: string, fd: FormData): Promise<never> {
  const actor = await staff('products.write');
  const back = base === '/admin/inputs' ? '/admin/inputs' : '/admin/products';
  const to = (['active', 'draft', 'archived'] as const).find((s) => s === status);
  const n = to ? await setProductStatus(fd.getAll('ids').map(String), to, actor) : 0;
  revalidatePath(back);
  redirect(`${back}?done=${n}`);
}
