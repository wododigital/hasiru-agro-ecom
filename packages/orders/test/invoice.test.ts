import './viewers';
import { setSettings } from '@ecomkit/core/settings';
import { TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ordersInvoice } from '../src/schema';
import { configureOrders, invoicePdf, issueInvoice, markPaymentReceived, onOrderPaid, ordersSettings, type InvoiceDocument } from '../src/server';
import { ordersDb, placeTestOrder } from './helpers';

let t: TestDb;

beforeAll(async () => {
  t = await ordersDb('invoice');
  configureOrders({ inventory: null, discounts: null, payments: null, catalog: null });
  await setSettings(ordersSettings, { sellerStateCode: 'KA', sellerLegalName: 'Sample Nursery Pvt Ltd', sellerGstin: '29ABCDE1234F1Z5', invoicePrefix: 'INV' }, { actorId: null });
});
afterAll(async () => {
  await t?.close();
});

async function paidOrder(overrides: Parameters<typeof placeTestOrder>[0] = {}) {
  const o = await placeTestOrder(overrides);
  await markPaymentReceived({ orderId: o.id, amountPaise: 264_300, attemptId: `a-${o.id}` });
  return o;
}

describe('GST invoice', () => {
  it('B2C intra-state: CGST + SGST by HSN, numbered INV-<FY>-NNNNN, issued once', async () => {
    const o = await paidOrder();
    const inv = await issueInvoice(o.id, { now: TEST_NOW });
    expect(inv).not.toBeNull();
    expect(inv!.number).toMatch(/^INV-2026-27-\d{5}$/);
    expect(inv).toMatchObject({ kind: 'b2c', placeOfSupply: 'KA', isInterState: false, igstPaise: 0, totalPaise: 264_300 });
    // compost 52,500 at 5% -> 2,500 tax; delivery 11,800 at 18% -> 1,800 tax
    expect(inv!.cgstPaise + inv!.sgstPaise).toBe(4_300);
    expect(inv!.taxablePaise + inv!.cgstPaise + inv!.sgstPaise).toBe(264_300);
    expect((await issueInvoice(o.id))!.number).toBe(inv!.number);
    const doc = inv!.document as InvoiceDocument;
    expect(doc.tax.rows.map((r) => r.hsn)).toEqual(['0602', '3101', '9965']);
    expect(doc.seller.gstin).toBe('29ABCDE1234F1Z5');
  });

  it('B2B inter-state: GSTIN and legal name on the invoice, all IGST', async () => {
    const base = (await import('./helpers')).orderInput();
    const o = await paidOrder({
      billing: { gstin: '33ABCDE1234F1Z5', legalName: 'Buyer Farms LLP' },
      shippingAddress: { ...base.shippingAddress!, state: 'Tamil Nadu', stateCode: 'TN' },
    });
    const inv = await issueInvoice(o.id);
    expect(inv).toMatchObject({ kind: 'b2b', placeOfSupply: 'TN', isInterState: true, cgstPaise: 0, sgstPaise: 0, igstPaise: 4_300 });
    expect((inv!.document as InvoiceDocument).buyer).toMatchObject({ gstin: '33ABCDE1234F1Z5', legalName: 'Buyer Farms LLP' });
  });

  it('no invoice for unpaid or zero-value replacement orders', async () => {
    const unpaid = await placeTestOrder();
    expect(await issueInvoice(unpaid.id)).toBeNull();
    const zero = await placeTestOrder({
      source: 'replacement',
      paymentMode: 'none',
      initialStatus: 'confirmed',
      totals: { subtotalPaise: 0, tierSavingsPaise: 0, promoPaise: 0, couponPaise: 0, packingPaise: 0, shippingPaise: 0, taxPaise: 0, totalPaise: 0, weightKg: 1, breakdown: {} },
    });
    expect(await issueInvoice(zero.id)).toBeNull();
  });

  it('the order.paid subscriber issues the invoice', async () => {
    const o = await paidOrder();
    const logged: unknown[] = [];
    await onOrderPaid({ orderId: o.id, orderNumber: o.number, amountPaise: 264_300 as never, paymentAttemptId: null }, { eventId: 'e', emittedAt: TEST_NOW, log: { info: (...a) => logged.push(a), warn: () => {}, error: () => {} } });
    const [row] = await t.db.select().from(ordersInvoice).where(eq(ordersInvoice.orderId, o.id));
    expect(row?.number).toMatch(/^INV-/);
  });

  // 50 concurrent issuances (one per order) need many real connections and lock waits under the parallel run.
  it('gapless and strictly sequential under 50 concurrent issuances', { timeout: 60_000 }, async () => {
    const orders = await Promise.all(Array.from({ length: 50 }, () => paidOrder()));
    const fy = '2027-28';
    const at = new Date('2027-06-01T10:00:00+05:30');
    const issued = await Promise.all(orders.map((o) => issueInvoice(o.id, { now: at })));
    const numbers = issued.map((i) => Number(i!.number.slice(-5))).sort((a, b) => a - b);
    expect(issued.every((i) => i!.number.startsWith(`INV-${fy}-`))).toBe(true);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, k) => k + 1));
    const { rows } = await t.db.execute<{ value: string }>(sql`select value from core_sequence where name = ${`invoice:${fy}`}`);
    expect(Number(rows[0]!.value)).toBe(50);
  });

  it('renders the invoice PDF from the frozen document', async () => {
    const o = await paidOrder();
    const inv = await issueInvoice(o.id);
    const pdf = await invoicePdf(inv!.document as InvoiceDocument);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
