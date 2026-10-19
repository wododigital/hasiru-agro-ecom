'use server';

import { getViewer } from '@ecomkit/core/auth-context';
import { zodAction, type ActionResult } from '@ecomkit/core/validation';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { addRedirect, deletePageMeta, dismissNotFound, fixNotFound, RedirectError, removeRedirect, savePageMeta } from '../server';

const actor = async () => {
  const v = await getViewer();
  return v.kind === 'staff' ? v.userId : null;
};
const path = z.string().trim().min(1).max(512);
const optText = z.string().trim().max(500).transform((s) => s || null);
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

/** Redirect-chain or loop refusals come back as a field error instead of a 500. */
async function guarded(fn: () => Promise<void>): Promise<void | { field: string; code: string }> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof RedirectError) return { field: 'to', code: err.reason };
    throw err;
  }
}

const back = (target: string, r: ActionResult<void | { field: string; code: string }>): never => {
  const code = !r.ok ? (r.formError ?? Object.keys(r.fieldErrors)[0] ?? 'invalid') : r.data ? `${r.data.field}-${r.data.code}` : null;
  const to = target.startsWith('/admin/') && !target.startsWith('//') ? target : '/admin/seo';
  const sep = to.includes('?') ? '&' : '?';
  redirect(code ? `${to}${sep}error=${encodeURIComponent(code)}` : `${to}${sep}saved=1`);
};

const addSchema = z.object({ from: path, to: path, statusCode: z.coerce.number().pipe(z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])).default(301) });
const add = zodAction(addSchema, async (d) => guarded(async () => void (await addRedirect(d.from, d.to, { statusCode: d.statusCode, source: 'manual', actorId: await actor() }))), { permission: 'content.write' });

export async function addRedirectForm(form: FormData): Promise<void> {
  back(String(form.get('back') || '/admin/seo'), await add(form));
}

const remove = zodAction(z.object({ id: z.uuid() }), async (d) => removeRedirect(d.id, await actor()), { permission: 'content.write' });

export async function removeRedirectForm(form: FormData): Promise<void> {
  back(String(form.get('back') || '/admin/seo'), await remove(form));
}

const fix = zodAction(z.object({ path, to: path }), async (d) => guarded(async () => fixNotFound(d.path, d.to, await actor())), { permission: 'content.write' });

export async function fixNotFoundForm(form: FormData): Promise<void> {
  back('/admin/seo/not-found', await fix(form));
}

const dismiss = zodAction(z.object({ path }), async (d) => dismissNotFound(d.path), { permission: 'content.write' });

export async function dismissNotFoundForm(form: FormData): Promise<void> {
  back('/admin/seo/not-found', await dismiss(form));
}

const metaSchema = z.object({
  path,
  title: optText,
  description: optText,
  noindex: checkbox,
  canonical: optText,
  ogMediaId: z.union([z.uuid(), z.literal('')]).transform((s) => s || null),
});
const saveMeta = zodAction(metaSchema, async (d) => void (await savePageMeta(d, await actor())), { permission: 'content.write' });

export async function savePageMetaForm(form: FormData): Promise<void> {
  back(String(form.get('back') || '/admin/seo/page-meta'), await saveMeta(form));
}

const deleteMeta = zodAction(z.object({ path }), async (d) => deletePageMeta(d.path, await actor()), { permission: 'content.write' });

export async function deletePageMetaForm(form: FormData): Promise<void> {
  back('/admin/seo/page-meta', await deleteMeta(form));
}
