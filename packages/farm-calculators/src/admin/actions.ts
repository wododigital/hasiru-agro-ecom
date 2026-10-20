'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getViewer } from '@ecomkit/core/auth-context';
import { zodAction } from '@ecomkit/core/validation';
import { dosageRuleSchema } from '../domain';
import { deleteDosageRule, DuplicateRuleError, saveDosageRule } from '../server/rules';

const ADMIN_PATH = '/admin/dosage-rules';

const actorId = async () => {
  const v = await getViewer();
  return v.kind === 'staff' ? v.userId : null;
};

export const saveRuleAction = zodAction(
  dosageRuleSchema.extend({ id: z.uuid().optional().or(z.literal('').transform(() => undefined)) }),
  async (input) => {
    try {
      const id = await saveDosageRule(input, await actorId());
      return { id, duplicate: false };
    } catch (err) {
      if (err instanceof DuplicateRuleError) return { id: null, duplicate: true };
      throw err;
    }
  },
  { permission: 'products.write' },
);

export const deleteRuleAction = zodAction(z.object({ id: z.uuid() }), async ({ id }) => ({ deleted: await deleteDosageRule(id, await actorId()) }), { permission: 'products.write' });

/** Form actions: the page re-renders with the result in the query string. */
export async function saveRuleForm(formData: FormData): Promise<void> {
  const r = await saveRuleAction(formData);
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?status=${r.ok ? (r.data.duplicate ? 'duplicate' : 'saved') : r.formError === 'forbidden' ? 'forbidden' : 'invalid'}`);
}

export async function deleteRuleForm(formData: FormData): Promise<void> {
  const r = await deleteRuleAction(formData);
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?status=${r.ok ? 'deleted' : 'invalid'}`);
}
