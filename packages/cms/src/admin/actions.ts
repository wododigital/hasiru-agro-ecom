'use server';

import { getViewer } from '@ecomkit/core/auth-context';
import { zodAction, type ActionResult } from '@ecomkit/core/validation';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ENTITIES, isEntityKey, menuItemsSchema, menuKeySchema, pageInputSchema, reqText, type EntityKey } from '../domain';
import { CmsWriteError, deleteEntity, deleteMenu, deletePage, saveEntity, saveMenu, savePage } from '../server';

const PERMISSION = { permission: 'content.write' as const };

const actor = async () => {
  const v = await getViewer();
  return v.kind === 'staff' ? v.userId : null;
};

/** A write conflict (taken slug, missing row) comes back as a field error, not a 500. */
async function conflicts<T>(fn: () => Promise<T>): Promise<T | ActionResult<never>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CmsWriteError) return { ok: false, fieldErrors: err.code === 'slug_taken' ? { slug: ['already used by another entry'] } : {}, formError: err.code === 'not_found' ? 'not_found' : 'invalid' };
    throw err;
  }
}

const unwrap = (r: ActionResult<ActionResult<never> | void>): ActionResult<void> => (r.ok && r.data && !r.data.ok ? r.data : r.ok ? { ok: true, data: undefined } : r);

// ---- pages -------------------------------------------------------------------------

const pageForm = z.object({ id: z.union([z.uuid(), z.literal('')]).transform((v) => v || null) }).and(pageInputSchema);
const savePageInner = zodAction(
  pageForm,
  async ({ id, ...input }) =>
    conflicts(async () => {
      const saved = await savePage(id, input, await actor());
      redirect(`/admin/content/pages/${saved}?saved=1`);
    }),
  PERMISSION,
);

/** Page editor submit (called from the form island; errors keep the admin's input on screen). */
export async function savePageAction(form: FormData): Promise<ActionResult<void>> {
  return unwrap(await savePageInner(form));
}

const removePage = zodAction(z.object({ id: z.uuid() }), async ({ id }) => deletePage(id, await actor()), PERMISSION);

export async function deletePageForm(form: FormData): Promise<void> {
  const r = await removePage(form);
  redirect(r.ok ? '/admin/content/pages?deleted=1' : `/admin/content/pages?error=${r.formError ?? 'invalid'}`);
}

// ---- menus -------------------------------------------------------------------------

const menuForm = z.object({ key: menuKeySchema, label: z.string().trim().max(80).default(''), items: menuItemsSchema });
const saveMenuInner = zodAction(
  menuForm,
  async ({ key, label, items }) => {
    await saveMenu(key, label, items, await actor());
    redirect(`/admin/content/menus/${key}?saved=1`);
  },
  PERMISSION,
);

export async function saveMenuAction(form: FormData): Promise<ActionResult<void>> {
  return saveMenuInner(form);
}

const removeMenu = zodAction(z.object({ key: menuKeySchema }), async ({ key }) => deleteMenu(key, await actor()), PERMISSION);

export async function deleteMenuForm(form: FormData): Promise<void> {
  const r = await removeMenu(form);
  redirect(r.ok ? '/admin/content/menus?deleted=1' : `/admin/content/menus?error=${r.formError ?? 'invalid'}`);
}

// ---- simple content types ------------------------------------------------------------------

const entityKey = z.string().refine(isEntityKey);

/** Saves one row of any simple content type; the type's own zod schema validates the fields. */
export async function saveEntityAction(form: FormData): Promise<ActionResult<void>> {
  const key = entityKey.safeParse(form.get('_entity'));
  if (!key.success) return { ok: false, fieldErrors: {}, formError: 'invalid' };
  const k = key.data as EntityKey;
  const id = String(form.get('_id') ?? '') || null;
  const action = zodAction(
    ENTITIES[k].schema as z.ZodType<Record<string, unknown>>,
    async (input) =>
      conflicts(async () => {
        const saved = await saveEntity(k, id, input as never, await actor());
        redirect(`/admin/content/${k}/${encodeURIComponent(saved)}?saved=1`);
      }),
    PERMISSION,
  );
  return unwrap(await action(form));
}

const removeEntity = zodAction(z.object({ _entity: entityKey, _id: reqText(120) }), async (d) => deleteEntity(d._entity as EntityKey, d._id, await actor()), PERMISSION);

export async function deleteEntityForm(form: FormData): Promise<void> {
  const r = await removeEntity(form);
  const k = String(form.get('_entity'));
  const base = isEntityKey(k) ? `/admin/content/${k}` : '/admin/content';
  redirect(r.ok ? `${base}?deleted=1` : `${base}?error=${r.formError ?? 'invalid'}`);
}
