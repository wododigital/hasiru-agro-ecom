import { vi } from 'vitest';
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
import { asGuest } from './viewers';
import { newId } from '@ecomkit/core/ids';
import type { TestDb } from '@ecomkit/core/testing';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { placeOrder, quote } from '../src/server';
import { CheckoutPage, PayPage } from '../src/ui';
import { ADDRESS, checkoutDb, wire } from './helpers';

let t: TestDb;
const html = async (el: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await el);

beforeAll(async () => {
  t = await checkoutDb('render');
  asGuest();
});
afterAll(async () => {
  await t?.close();
});

describe('checkout page', () => {
  it('renders the three sections, delivery options with dates, payment choices and the pay amount', async () => {
    wire(newId());
    // The buyer already typed a Bengaluru pincode and picked local delivery (stored on the session).
    await quote({ address: { pincode: '560001', districtSlug: 'bengaluru-urban', stateCode: 'KA' }, methodId: 'local' });
    const out = await html(CheckoutPage({}));
    for (const text of ['Contact', 'Delivery address', 'Delivery and payment', 'Mobile number', 'Pincode', 'Local delivery', 'Pickup from the nursery', 'Pay an advance now', 'Pay Rs 20,150', 'Bulk savings', 'SAVE500', 'GST included', 'no cancellation or return']) {
      expect(out, text).toContain(text);
    }
    expect(out).toContain('name="idempotencyKey"');
    expect(out).toContain('value="2015000"');
    expect(out).toContain('Tamil Nadu');
    expect(out).toContain('data-cta="checkout-pay"');
  });

  it('a fresh checkout without an address defaults to the first available method', async () => {
    wire(newId());
    const out = await html(CheckoutPage({}));
    expect(out).toContain('Pay Rs 18,650');
    expect(out).toContain('Pickup from the nursery: no address needed.');
  });

  it('shows an empty state without a cart', async () => {
    const h = wire(newId());
    h.cart = null;
    expect(await html(CheckoutPage({}))).toContain('Your cart is empty');
  });

  it('pay page: amount due and a retry button for the buyer, 404 for anyone else', async () => {
    wire(newId());
    const res = await placeOrder({ idempotencyKey: newId(), name: 'Asha', phone: '9876543210', address: ADDRESS, methodId: 'local', paymentChoice: 'online', policyAck: true });
    if (!res.ok) throw new Error(res.formError);
    const out = await html(PayPage({ orderId: res.orderId, token: `tok-${res.orderId}` }));
    expect(out).toContain('Pay now Rs 20,150');
    expect(out).toContain(res.number);
    await expect(PayPage({ orderId: res.orderId, token: 'nope' })).rejects.toMatchObject({ digest: expect.stringContaining('404') });
  });
});
