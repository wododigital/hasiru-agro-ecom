'use server';

import { requirePermission } from '@ecomkit/core/auth-context';
import { zodAction, type ActionResult } from '@ecomkit/core/validation';
import { variantPricingFormSchema } from '../domain';
import { saveVariantPricing } from '../server/pricing';

const save = zodAction(variantPricingFormSchema, async (input) => {
  const staff = await requirePermission('pricing.write');
  return saveVariantPricing(input, { actorId: staff.userId });
}, { permission: 'pricing.write' });

/** Pricing tab form action (`useActionState` shape). Needs `pricing.write`. */
export async function savePricingAction(_prev: ActionResult<{ changed: boolean }> | null, form: FormData): Promise<ActionResult<{ changed: boolean }>> {
  return save(form);
}
