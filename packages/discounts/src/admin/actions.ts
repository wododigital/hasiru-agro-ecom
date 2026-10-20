'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePermission } from '@ecomkit/core/auth-context';
import { zodAction, type ActionResult } from '@ecomkit/core/validation';
import { generateCodes, ruleFormSchema } from '../domain';
import { addCodes, saveRule, setRulesStatus } from '../server/discounts';

const PERMISSION = 'marketing.write' as const;

const save = zodAction(
  ruleFormSchema,
  async (input) => {
    const staff = await requirePermission(PERMISSION);
    return { ...(await saveRule(input, { actorId: staff.userId })), created: !input.id };
  },
  { permission: PERMISSION },
);

/** Rule form. A new rule redirects to its own page (where codes are added); an edit returns in place. */
export async function saveRuleAction(_prev: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await save(form);
  if (res.ok && res.data.created) redirect(`/admin/discounts/${res.data.id}`);
  return res.ok ? { ok: true, data: { id: res.data.id } } : res;
}

const codesFormSchema = z
  .object({
    ruleId: z.uuid(),
    codes: z.string().max(20_000).default(''),
    generate: z.union([z.literal(''), z.coerce.number().int().min(1).max(500)]).default(''),
    prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{0,12}$/).default(''),
  })
  .transform((f) => ({
    ruleId: f.ruleId,
    codes: [...f.codes.split(/[\s,]+/).filter(Boolean), ...(f.generate === '' ? [] : generateCodes(f.generate, { prefix: f.prefix }))],
  }))
  .refine((f) => f.codes.length > 0, { path: ['codes'], message: 'Enter codes or a number to generate' });

const addCodesSafe = zodAction(
  codesFormSchema,
  async ({ ruleId, codes }) => {
    const staff = await requirePermission(PERMISSION);
    try {
      return await addCodes(ruleId, codes, { actorId: staff.userId });
    } catch (err) {
      if (err instanceof RangeError) return { added: [], skipped: [], error: err.message };
      throw err;
    }
  },
  { permission: PERMISSION },
);

export async function addCodesAction(
  _prev: ActionResult<{ added: string[]; skipped: string[]; error?: string }> | null,
  form: FormData,
): Promise<ActionResult<{ added: string[]; skipped: string[]; error?: string }>> {
  return addCodesSafe(form);
}

/** Bulk status from the index (row checkboxes), bound per button; the bound status comes from the client, so it is checked. */
export async function bulkRuleStatusAction(status: string, form: FormData): Promise<void> {
  const staff = await requirePermission(PERMISSION);
  const to = (['active', 'paused', 'archived'] as const).find((s) => s === status);
  if (to) await setRulesStatus(form.getAll('ids').map(String), to, { actorId: staff.userId });
  revalidatePath('/admin/discounts');
}
