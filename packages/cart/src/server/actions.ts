'use server';

// Server actions behind the cart page and drawer. Each one changes the visitor's own cart (resolved from the
// cookie and viewer, never from a client-sent cart id), then refreshes the route so server-rendered parts
// (summary, cart blocks, header count) re-render.
import { refresh } from 'next/cache';
import { z } from 'zod';
import { couponSchema, methodSchema, setQtySchema } from '../domain';
import { removeLine, setDeliveryMethod, setQty, storeCoupon } from './cart';
import { currentCartContext } from './request';
import { applyCoupon } from './view';

const lineIdSchema = z.object({ lineId: z.uuid() });

/** Stepper change (page and drawer). */
export async function setLineQtyAction(lineId: string, qty: number): Promise<void> {
  const data = setQtySchema.safeParse({ lineId, qty });
  if (!data.success) return;
  await setQty(await currentCartContext(), data.data);
  refresh();
}

export async function removeLineAction(form: FormData): Promise<void> {
  const data = lineIdSchema.safeParse({ lineId: form.get('lineId') });
  if (!data.success) return;
  await removeLine(await currentCartContext(), data.data.lineId);
  refresh();
}

export type CouponActionState = { ok: boolean; reason: string | null; code: string | null } | null;

export async function applyCouponAction(_prev: CouponActionState, form: FormData): Promise<CouponActionState> {
  const data = couponSchema.safeParse({ code: form.get('code') });
  if (!data.success) return { ok: false, reason: 'invalid', code: null };
  const outcome = await applyCoupon(await currentCartContext(), data.data.code);
  refresh();
  return outcome.ok ? { ok: true, reason: null, code: outcome.code } : { ok: false, reason: outcome.reason, code: null };
}

export async function removeCouponAction(): Promise<void> {
  await storeCoupon(await currentCartContext(), null);
  refresh();
}

export async function setDeliveryMethodAction(form: FormData): Promise<void> {
  const data = methodSchema.safeParse({ methodId: form.get('methodId') || null });
  if (!data.success) return;
  await setDeliveryMethod(await currentCartContext(), data.data.methodId);
  refresh();
}
