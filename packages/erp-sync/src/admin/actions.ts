'use server';

import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import type { Permission } from '@ecomkit/core/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { mapSku, MappingError, retryOutbox, unmapSku, variantCandidates } from '../server';

const retryForm = z.object({ id: z.uuid() });
const mapForm = z.object({ erpItemId: z.string().trim().min(1).max(200), variant: z.string().trim().min(1).max(200) });
const unmapForm = z.object({ variantId: z.uuid() });

async function staff(permission: Permission): Promise<string | null> {
  try {
    return (await requirePermission(permission)).userId;
  } catch (err) {
    if (err instanceof ForbiddenError) return null;
    throw err;
  }
}

export async function retryOutboxAction(form: FormData): Promise<void> {
  const actorId = await staff('jobs.retry');
  const parsed = retryForm.safeParse(Object.fromEntries(form));
  if (!actorId || !parsed.success) return;
  await retryOutbox(parsed.data.id, actorId);
  revalidatePath('/admin/erp');
}

/** Links an ERP item to a variant given by id or SKU. */
export async function mapItemAction(form: FormData): Promise<void> {
  const actorId = await staff('inventory.write');
  const parsed = mapForm.safeParse(Object.fromEntries(form));
  if (!actorId || !parsed.success) return;
  const wanted = parsed.data.variant.toLowerCase();
  const match = (await variantCandidates()).find((c) => c.variantId === wanted || c.sku?.toLowerCase() === wanted);
  if (!match) return;
  try {
    await mapSku({ variantId: match.variantId, erpItemId: parsed.data.erpItemId }, actorId);
  } catch (err) {
    if (!(err instanceof MappingError)) throw err;
  }
  revalidatePath('/admin/settings/erp-sync');
}

export async function unmapItemAction(form: FormData): Promise<void> {
  const actorId = await staff('inventory.write');
  const parsed = unmapForm.safeParse(Object.fromEntries(form));
  if (!actorId || !parsed.success) return;
  await unmapSku(parsed.data.variantId, actorId);
  revalidatePath('/admin/settings/erp-sync');
}
