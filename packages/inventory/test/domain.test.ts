import { describe, expect, it } from 'vitest';
import { crossedLowStock, deriveStock, erpItemSchema, notifyMeSchema } from '../src/domain';

const level = (onHand: number, reserved = 0, extra: { readyInDays?: number | null; lowStockThreshold?: number | null } = {}) => ({
  variantId: 'v',
  onHand,
  reserved,
  readyInDays: extra.readyInDays ?? null,
  lowStockThreshold: extra.lowStockThreshold ?? null,
});

describe('deriveStock', () => {
  it('floors sellable stock at zero when reservations exceed a lowered on_hand', () => {
    expect(deriveStock(level(2, 5))).toMatchObject({ available: 0, availability: 'out_of_stock' });
  });
  it('is preorder only when nothing is sellable and a ready date exists', () => {
    expect(deriveStock(level(0, 0, { readyInDays: 14 })).availability).toBe('preorder');
    expect(deriveStock(level(3, 0, { readyInDays: 14 })).availability).toBe('in_stock');
  });
  it('low stock uses the variant threshold, else the fallback, and never for zero stock', () => {
    expect(deriveStock(level(3, 0, { lowStockThreshold: 3 })).lowStock).toBe(true);
    expect(deriveStock(level(4, 0, { lowStockThreshold: 3 })).lowStock).toBe(false);
    expect(deriveStock(level(4), 5).lowStock).toBe(true);
    expect(deriveStock(level(4), null).lowStock).toBe(false);
    expect(deriveStock(level(0, 0, { lowStockThreshold: 3 })).lowStock).toBe(false);
  });
});

describe('crossedLowStock', () => {
  it('fires only on the crossing, not while already low or when sold out', () => {
    expect(crossedLowStock(6, 5, 5)).toBe(true);
    expect(crossedLowStock(5, 4, 5)).toBe(false);
    expect(crossedLowStock(6, 0, 5)).toBe(false);
    expect(crossedLowStock(6, 5, null)).toBe(false);
  });
});

describe('schemas', () => {
  const variantId = '01a15642-fb97-7001-ab13-db91359cc9ba';
  it('notify-me needs consent and a contact; empty strings count as absent', () => {
    expect(notifyMeSchema.safeParse({ variantId, phone: '', email: '', consent: true }).success).toBe(false);
    expect(notifyMeSchema.safeParse({ variantId, email: 'a@example.com', consent: false }).success).toBe(false);
    expect(notifyMeSchema.parse({ variantId, phone: '', email: 'a@example.com', consent: true })).toEqual({ variantId, email: 'a@example.com', consent: true });
  });
  it('ERP items clamp negative stock to zero', () => {
    expect(erpItemSchema.parse({ variantId, onHand: -3 }).onHand).toBe(0);
  });
});
