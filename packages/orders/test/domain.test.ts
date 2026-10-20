import { ROLE_PERMISSIONS } from '@ecomkit/core/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkTransition,
  invoiceTax,
  isInterState,
  parseManualLines,
  paymentStatusFor,
  placeOfSupply,
  slotLabel,
  staffMoves,
  type TransitionSubject,
} from '../src/domain';

const order = (o: Partial<TransitionSubject> = {}): TransitionSubject => ({ status: 'pending_payment', paymentStatus: 'unpaid', paidPaise: 0, refundedPaise: 0, ...o });
const staff = (role: keyof typeof ROLE_PERMISSIONS) => ({ type: 'staff' as const, id: 's', permissions: ROLE_PERMISSIONS[role] });
const system = { type: 'system' as const };

describe('status machine', () => {
  it('only the system marks an order paid, and only once money has arrived', () => {
    expect(checkTransition(order(), 'paid', system)).toEqual({ ok: false, reason: 'guard.no_payment' });
    expect(checkTransition(order({ paymentStatus: 'paid', paidPaise: 100 }), 'paid', system)).toEqual({ ok: true });
    expect(checkTransition(order({ paymentStatus: 'paid', paidPaise: 100 }), 'paid', staff('owner'))).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('walks paid -> confirmed -> packed -> dispatched -> delivered with per-move permissions', () => {
    const paid = order({ status: 'paid', paymentStatus: 'paid', paidPaise: 100 });
    expect(checkTransition(paid, 'confirmed', staff('fulfilment')).ok).toBe(true);
    expect(checkTransition(paid, 'confirmed', staff('support'))).toEqual({ ok: false, reason: 'forbidden' });
    expect(checkTransition({ ...paid, status: 'confirmed' }, 'packed', staff('fulfilment')).ok).toBe(true);
    expect(checkTransition({ ...paid, status: 'packed' }, 'dispatched', staff('fulfilment')).ok).toBe(true);
    expect(checkTransition({ ...paid, status: 'dispatched' }, 'delivered', staff('fulfilment')).ok).toBe(true);
    // no skipping, no going back
    expect(checkTransition(paid, 'dispatched', staff('owner'))).toEqual({ ok: false, reason: 'not_allowed' });
    expect(checkTransition({ ...paid, status: 'delivered' }, 'packed', staff('owner'))).toEqual({ ok: false, reason: 'not_allowed' });
    expect(checkTransition({ ...paid, status: 'cancelled' }, 'confirmed', staff('owner'))).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('never cancels an order that has taken money (policy: refunds only)', () => {
    expect(checkTransition(order(), 'cancelled', staff('manager')).ok).toBe(true);
    expect(checkTransition(order({ status: 'confirmed' }), 'cancelled', staff('manager')).ok).toBe(true);
    expect(checkTransition(order({ status: 'confirmed', paymentStatus: 'partially_paid', paidPaise: 10 }), 'cancelled', staff('owner'))).toEqual({ ok: false, reason: 'guard.has_payment' });
    expect(checkTransition(order({ status: 'paid', paidPaise: 10, paymentStatus: 'paid' }), 'cancelled', staff('owner'))).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('refund states follow the refunded amount and are system moves', () => {
    const delivered = order({ status: 'delivered', paymentStatus: 'paid', paidPaise: 1000 });
    expect(checkTransition({ ...delivered, refundedPaise: 400 }, 'partially_refunded', system).ok).toBe(true);
    expect(checkTransition({ ...delivered, refundedPaise: 400 }, 'refunded', system)).toEqual({ ok: false, reason: 'guard.refund_partial' });
    expect(checkTransition({ ...delivered, refundedPaise: 1000 }, 'refunded', system).ok).toBe(true);
    expect(checkTransition({ ...delivered, refundedPaise: 1000 }, 'refunded', staff('owner'))).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('offers staff only the moves their role may make', () => {
    const paid = order({ status: 'paid', paymentStatus: 'paid', paidPaise: 100 });
    expect(staffMoves(paid, ROLE_PERMISSIONS.fulfilment)).toEqual(['confirmed']);
    expect(staffMoves(paid, ROLE_PERMISSIONS.support)).toEqual([]);
    expect(staffMoves(order(), ROLE_PERMISSIONS.owner)).toEqual(['cancelled']);
  });
});

describe('payments arithmetic', () => {
  it('derives payment status', () => {
    expect(paymentStatusFor(1000, 0)).toBe('unpaid');
    expect(paymentStatusFor(1000, 300)).toBe('partially_paid');
    expect(paymentStatusFor(1000, 1000)).toBe('paid');
    expect(paymentStatusFor(0, 0)).toBe('paid');
    expect(paymentStatusFor(1000, 1000, 1000)).toBe('refunded');
  });
});

describe('GST invoice maths (A7: inclusive prices)', () => {
  const lines = [
    { name: 'Sapling', sku: 'A', hsn: '0602', qty: 10, gstRatePct: 0, lineTotalPaise: 200_000 },
    { name: 'Compost', sku: 'C', hsn: '3101', qty: 1, gstRatePct: 5, lineTotalPaise: 52_500 },
    { name: 'Compost small', sku: 'D', hsn: '3101', qty: 1, gstRatePct: 5, lineTotalPaise: 10_500 },
    { name: 'Bio pesticide', sku: 'B', hsn: '3808', qty: 1, gstRatePct: 18, lineTotalPaise: 11_800 },
  ];

  it('intra-state: CGST + SGST halves per HSN group; taxable + tax adds back to the total', () => {
    const t = invoiceTax({ lines, chargesPaise: 11_800, chargesGstRatePct: 18, chargesHsn: '9965', interState: false });
    expect(t.rows.map((r) => [r.hsn, r.ratePct, r.taxablePaise, r.cgstPaise, r.sgstPaise, r.igstPaise])).toEqual([
      ['0602', 0, 200_000, 0, 0, 0],
      ['3101', 5, 60_000, 1_500, 1_500, 0],
      ['3808', 18, 10_000, 900, 900, 0],
      ['9965', 18, 10_000, 900, 900, 0],
    ]);
    expect(t.totalPaise).toBe(286_600);
    expect(t.taxablePaise + t.cgstPaise + t.sgstPaise).toBe(t.totalPaise);
    expect(t.igstPaise).toBe(0);
  });

  it('inter-state: everything is IGST, same total tax', () => {
    const t = invoiceTax({ lines, chargesPaise: 11_800, chargesGstRatePct: 18, chargesHsn: '9965', interState: true });
    expect([t.cgstPaise, t.sgstPaise, t.igstPaise]).toEqual([0, 0, 6_600]);
    expect(t.taxablePaise + t.igstPaise).toBe(286_600);
  });

  it('odd paisa goes to SGST and rounding never loses a paisa', () => {
    const t = invoiceTax({ lines: [{ name: 'x', sku: null, hsn: '3101', qty: 1, gstRatePct: 5, lineTotalPaise: 90_000 }], chargesPaise: 0, chargesGstRatePct: 18, chargesHsn: '9965', interState: false });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ taxablePaise: 85_714, cgstPaise: 2_143, sgstPaise: 2_143 });
    expect(t.taxablePaise + t.cgstPaise + t.sgstPaise).toBe(90_000);
  });

  it('place of supply is the delivery state; pickup is the seller state', () => {
    expect(placeOfSupply({ kind: 'local_slot' }, { stateCode: 'TN' }, 'KA')).toBe('TN');
    expect(placeOfSupply({ kind: 'pickup' }, { stateCode: 'TN' }, 'KA')).toBe('KA');
    expect(isInterState('TN', 'KA')).toBe(true);
    expect(isInterState('KA', 'KA')).toBe(false);
    expect(isInterState(null, 'KA')).toBe(false);
  });
});

describe('dates', () => {
  it('labels a slot date the way the storefront promises it', () => {
    expect(slotLabel('2026-10-24')).toBe('Saturday 24 Oct');
  });
});

describe('manual order lines', () => {
  it('parses SKU, qty and an optional rupee price, and rejects bad rows', () => {
    expect(parseManualLines('SKU-1, 10\n\n SKU-2,5, 320.5 ')).toEqual([
      { sku: 'SKU-1', qty: 10, unitPaise: null },
      { sku: 'SKU-2', qty: 5, unitPaise: 32_050 },
    ]);
    expect(() => parseManualLines('SKU-1, ten')).toThrow(RangeError);
    expect(() => parseManualLines('SKU-1, 0')).toThrow(RangeError);
  });
});
