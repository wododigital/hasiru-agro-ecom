'use server';

import { getViewer } from '@ecomkit/core/auth-context';
import { zodAction } from '@ecomkit/core/validation';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assetMetaSchema } from '../domain';
import { deleteAsset, deriveAsset, MediaInUseError, updateAsset } from '../server/assets';

const actorId = async () => {
  const v = await getViewer();
  return v.kind === 'staff' ? v.userId : null;
};

const idSchema = z.object({ id: z.uuid() });
// An unchecked checkbox sends nothing, so "absent" means false on this form.
const saveSchema = assetMetaSchema.extend({ id: z.uuid(), creditRequired: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()) });

const save = zodAction(saveSchema, async ({ id, ...meta }) => updateAsset(id, meta, await actorId()), { permission: 'media.write' });
const remove = zodAction(
  idSchema,
  async ({ id }) => {
    try {
      await deleteAsset(id, await actorId());
      return 'deleted' as const;
    } catch (err) {
      if (err instanceof MediaInUseError) return 'in_use' as const;
      throw err;
    }
  },
  { permission: 'media.write' },
);
const regenerate = zodAction(idSchema, async ({ id }) => deriveAsset(id), { permission: 'media.write' });

const back = (form: FormData, query: string) => `/admin/media/${encodeURIComponent(String(form.get('id') ?? ''))}?${query}`;

export async function saveAssetAction(form: FormData): Promise<void> {
  const r = await save(form);
  redirect(back(form, r.ok ? 'saved=1' : `error=${r.formError ?? 'invalid'}`));
}

export async function deleteAssetAction(form: FormData): Promise<void> {
  const r = await remove(form);
  if (r.ok && r.data === 'deleted') redirect('/admin/media?deleted=1');
  redirect(back(form, `error=${r.ok ? r.data : (r.formError ?? 'invalid')}`));
}

export async function regenerateAction(form: FormData): Promise<void> {
  const r = await regenerate(form);
  redirect(back(form, r.ok ? 'regenerated=1' : `error=${r.formError ?? 'invalid'}`));
}
