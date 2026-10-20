'use server';

import { clientIp } from '@ecomkit/core/http';
import { formDataToObject, zodAction, type ActionResult } from '@ecomkit/core/validation';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { placeOrderSchema, type ContactInput, type QuoteInput } from '../domain';
import { CheckoutError, placeOrder, quote, retryPayment, saveContact, setMarketingConsent, type PlaceOrderResult, type QuoteView } from '../server';

async function requestMeta() {
  const h = await headers();
  return { ip: clientIp({ headers: h }), userAgent: h.get('user-agent') };
}

type Soft<T> = { ok: true; data: T } | { ok: false; formError: string };
async function soft<T>(fn: () => Promise<T>): Promise<Soft<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof CheckoutError) return { ok: false, formError: err.code };
    if (err instanceof Error && err.name === 'ZodError') return { ok: false, formError: 'invalid' };
    throw err;
  }
}

/** Contact autosave on blur (the island debounces). */
export async function saveContactAction(input: ContactInput): Promise<Soft<{ changed: boolean }>> {
  return soft(() => saveContact(input));
}

/** Explicit tick or untick of the marketing checkbox. */
export async function marketingConsentAction(granted: boolean): Promise<Soft<{ recorded: boolean }>> {
  const meta = await requestMeta();
  return soft(() => setMarketingConsent(granted === true, meta));
}

/** Re-quote for an address or delivery method change. */
export async function quoteAction(input: QuoteInput): Promise<Soft<QuoteView>> {
  return soft(() => quote(input));
}

/** Reads the flat form into the place-order shape: address fields become `address` unless pickup left them blank. */
function placeInput(form: FormData) {
  const f = formDataToObject(form) as Record<string, string>;
  const addressKeys = ['line1', 'line2', 'landmark', 'villageTown', 'pincode', 'district', 'districtSlug', 'state', 'stateCode', 'farmPin'] as const;
  const hasAddress = addressKeys.some((k) => (f[k] ?? '').trim() !== '');
  const address = hasAddress ? { name: f.name, phone: f.phone, ...Object.fromEntries(addressKeys.map((k) => [k, f[k] ?? ''])) } : null;
  return { ...f, address };
}

const place = zodAction(placeOrderSchema, async (input) => placeOrder(input, await requestMeta()));

export type PlaceOrderState = ActionResult<PlaceOrderResult> | null;

/** The pay button. Works without JS (plain POST); on success the buyer goes to the payment page or the order page. */
export async function placeOrderAction(_prev: PlaceOrderState, form: FormData): Promise<PlaceOrderState> {
  const res = await place(placeInput(form) as never);
  if (res.ok && res.data.ok) redirect(res.data.next);
  return res;
}

export async function retryPaymentAction(form: FormData): Promise<void> {
  const orderId = String(form.get('orderId') ?? '');
  const token = String(form.get('t') ?? '') || null;
  const next = await retryPayment(orderId, token);
  redirect(next ?? '/');
}
