'use server';

import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import { z } from 'zod';
import { clearOverride, setLevel, StockError, updateLevelSettings } from '../server';

export type AdminActionState = { ok: boolean; message: string } | null;

/** Empty form field -> null, anything else -> a whole number >= 0. */
const optionalCount = z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().int().min(0).max(10_000_000).nullable());

const countForm = z.object({ variantId: z.uuid(), productId: z.uuid(), onHand: z.coerce.number().int().min(0).max(10_000_000), note: z.string().trim().max(500).optional() });
const settingsForm = z.object({ variantId: z.uuid(), lowStockThreshold: optionalCount, readyInDays: optionalCount });
const clearForm = z.object({ variantId: z.uuid() });

async function run<S extends z.ZodType>(schema: S, form: FormData, fn: (input: z.infer<S>, actorId: string) => Promise<string>): Promise<AdminActionState> {
  let actorId: string;
  try {
    actorId = (await requirePermission('inventory.write')).userId;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, message: 'You do not have permission to change stock.' };
    throw err;
  }
  const parsed = schema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { ok: false, message: 'Check the numbers: whole numbers of 0 or more.' };
  try {
    return { ok: true, message: await fn(parsed.data, actorId) };
  } catch (err) {
    if (err instanceof StockError) return { ok: false, message: err.code === 'negative' ? 'Stock cannot go below zero.' : 'No stock record for this variant.' };
    throw err;
  }
}

/** Counted stock: becomes a manual override that ERP pulls leave alone. */
export async function setCountAction(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return run(countForm, form, async (v, actorId) => {
    await setLevel({ variantId: v.variantId, productId: v.productId, onHand: v.onHand, note: v.note || null }, actorId);
    return `On hand set to ${v.onHand}. Manual override is on.`;
  });
}

export async function setLevelSettingsAction(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return run(settingsForm, form, async (v, actorId) => {
    await updateLevelSettings({ variantId: v.variantId, lowStockThreshold: v.lowStockThreshold, readyInDays: v.readyInDays }, actorId);
    return 'Saved.';
  });
}

export async function clearOverrideAction(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return run(clearForm, form, async (v, actorId) => {
    await clearOverride(v.variantId, actorId);
    return 'Override cleared. Stock follows the ERP again.';
  });
}
