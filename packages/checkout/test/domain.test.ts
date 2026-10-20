import { describe, expect, it } from 'vitest';
import { advanceFor, contactInputSchema, paymentChoices, placeOrderSchema, reserveLines, slotLabel } from '../src/domain';

describe('payment choices per COD mode (A14)', () => {
  it('online always; partial advance for deliveries; pay at the nursery only for pickup', () => {
    expect(paymentChoices('online_only', 'local_slot')).toEqual(['online']);
    expect(paymentChoices('partial_advance', 'outstation')).toEqual(['online', 'partial_advance']);
    expect(paymentChoices('partial_advance', 'pickup')).toEqual(['online']);
    expect(paymentChoices('pay_at_nursery', 'pickup')).toEqual(['online', 'pay_at_nursery']);
    expect(paymentChoices('pay_at_nursery', 'local_slot')).toEqual(['online']);
  });

  it('advance is the percentage rounded up to the rupee, never above the total', () => {
    expect(advanceFor(2_015_000, 30)).toBe(604_500);
    expect(advanceFor(264_300, 30)).toBe(79_300);
    expect(advanceFor(150, 99)).toBe(150);
    expect(advanceFor(10_000, 100)).toBe(10_000);
  });
});

describe('inputs', () => {
  it('normalises phones to E.164 and blanks to null', () => {
    expect(contactInputSchema.parse({ name: ' Asha ', phone: '098765 43210', email: '' })).toEqual({ name: 'Asha', phone: '+919876543210', email: null });
    expect(contactInputSchema.safeParse({ phone: '12345' }).success).toBe(false);
  });

  it('place-order needs the policy acknowledgement and a legal name with a GSTIN', () => {
    const base = { idempotencyKey: '0192f0f0-0000-7000-8000-000000000000', name: 'A', phone: '9876543210', methodId: 'pickup', paymentChoice: 'online', policyAck: 'on' };
    expect(placeOrderSchema.parse(base)).toMatchObject({ policyAck: true, marketingConsent: false, phone: '+919876543210' });
    expect(placeOrderSchema.safeParse({ ...base, policyAck: undefined }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, gstin: '29abcde1234f1z5' }).success).toBe(false);
    expect(placeOrderSchema.parse({ ...base, gstin: '29abcde1234f1z5', legalName: 'Farm LLP' }).gstin).toBe('29ABCDE1234F1Z5');
    expect(placeOrderSchema.safeParse({ ...base, gstin: 'NOTAGSTIN', legalName: 'x' }).success).toBe(false);
  });

  it('stock holds merge a variant that sits in the package and as an extra line', () => {
    expect(reserveLines([{ variantId: 'a', qty: 50 }, { variantId: 'b', qty: 1 }, { variantId: 'a', qty: 10 }])).toEqual([{ variantId: 'a', qty: 60 }, { variantId: 'b', qty: 1 }]);
  });

  it('labels delivery days the way the storefront promises them', () => {
    expect(slotLabel('2026-10-24')).toBe('Saturday 24 Oct');
  });
});
