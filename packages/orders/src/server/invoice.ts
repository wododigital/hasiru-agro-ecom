import type { EventHandler } from '@ecomkit/core/contracts';
import { db, withTx } from '@ecomkit/core/db';
import { invoiceNumber } from '@ecomkit/core/sequence';
import { getSettings } from '@ecomkit/core/settings';
import { eq } from 'drizzle-orm';
import { invoiceTax, isInterState, placeOfSupply, type InvoiceTax, type OrderAddress, type OrderBilling, type OrderContact, type ProductSnapshot } from '../domain';
import { ordersInvoice, ordersLine, ordersOrder } from '../schema';
import { ordersSettings } from './ports';

export type InvoiceRow = typeof ordersInvoice.$inferSelect;

/** Everything printed on the invoice, frozen at issue time; the PDF renders from this alone. */
export interface InvoiceDocument {
  number: string;
  kind: 'b2c' | 'b2b';
  issuedAt: string;
  orderNumber: string;
  placeOfSupply: string | null;
  isInterState: boolean;
  seller: { legalName: string; gstin: string; address: string; stateCode: string };
  buyer: { name: string; phone: string | null; email: string | null; address: string | null; gstin: string | null; legalName: string | null };
  lines: { name: string; sku: string | null; hsn: string | null; qty: number; gstRatePct: number; totalPaise: number }[];
  chargesPaise: number;
  discountPaise: number;
  tax: InvoiceTax;
}

const addressText = (a: OrderAddress | null) =>
  a ? [a.line1, a.line2, a.landmark, a.villageTown, a.district, a.state, a.pincode].filter(Boolean).join(', ') : null;

/**
 * Issues the GST invoice for a paid order, once (unique per order). The number comes from the financial year's
 * gapless sequence inside this transaction, so a rollback returns it. B2B when the order carries a GSTIN;
 * CGST + SGST when the place of supply is the seller's state, IGST otherwise. Zero-value replacement orders and
 * unpaid orders get no invoice. Returns the invoice, or null when none is due.
 */
export async function issueInvoice(orderId: string, options: { now?: Date } = {}): Promise<InvoiceRow | null> {
  return withTx(async (tx) => {
    const [order] = await tx.select().from(ordersOrder).where(eq(ordersOrder.id, orderId)).for('update');
    if (!order) return null;
    const [existing] = await tx.select().from(ordersInvoice).where(eq(ordersInvoice.orderId, orderId));
    if (existing) return existing;
    if (order.source === 'replacement' || order.totalPaise === 0 || order.paidPaise === 0) return null;

    const s = await getSettings(ordersSettings, tx);
    const lines = await tx.select().from(ordersLine).where(eq(ordersLine.orderId, orderId));
    const delivery = order.delivery as { kind: string };
    const address = (order.shippingAddress as OrderAddress | null) ?? null;
    const billing = (order.billing as OrderBilling | null) ?? null;
    const contact = order.contact as OrderContact;
    const pos = placeOfSupply(delivery, address, s.sellerStateCode);
    const interState = isInterState(pos, s.sellerStateCode);
    const chargesGstRatePct = Number((order.totals as { chargesGstRatePct?: number }).chargesGstRatePct ?? 0);
    const docLines = lines.map((l) => {
      const p = l.productSnapshot as ProductSnapshot;
      return { name: p.name, sku: p.sku, hsn: p.hsn, qty: l.qty, gstRatePct: p.gstRatePct, totalPaise: l.lineTotalPaise };
    });
    const tax = invoiceTax({
      lines: docLines.map((l) => ({ ...l, lineTotalPaise: l.totalPaise })),
      chargesPaise: order.packingPaise + order.shippingPaise,
      chargesGstRatePct,
      chargesHsn: s.chargesHsn,
      interState,
    });
    const now = options.now ?? new Date();
    const number = await invoiceNumber(tx, { prefix: s.invoicePrefix, at: now });
    const kind = billing?.gstin ? 'b2b' : 'b2c';
    const document: InvoiceDocument = {
      number,
      kind,
      issuedAt: now.toISOString(),
      orderNumber: order.number,
      placeOfSupply: pos,
      isInterState: interState,
      seller: { legalName: s.sellerLegalName, gstin: s.sellerGstin, address: s.sellerAddress, stateCode: s.sellerStateCode },
      buyer: {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        address: addressText(address),
        gstin: billing?.gstin ?? null,
        legalName: billing?.legalName ?? null,
      },
      lines: docLines,
      chargesPaise: order.packingPaise + order.shippingPaise,
      discountPaise: order.promoPaise + order.couponPaise,
      tax,
    };
    const [row] = await tx
      .insert(ordersInvoice)
      .values({
        orderId,
        number,
        kind,
        placeOfSupply: pos,
        isInterState: interState,
        taxablePaise: tax.taxablePaise,
        cgstPaise: tax.cgstPaise,
        sgstPaise: tax.sgstPaise,
        igstPaise: tax.igstPaise,
        totalPaise: tax.totalPaise,
        document,
        issuedAt: now,
      })
      .returning();
    return row!;
  });
}

export async function getInvoice(orderId: string): Promise<InvoiceRow | null> {
  const [row] = await db.select().from(ordersInvoice).where(eq(ordersInvoice.orderId, orderId));
  return row ?? null;
}

/** `order.paid` subscriber (runs as a worker job with the standard retries): issues the invoice. */
export const onOrderPaid: EventHandler<'order.paid'> = async ({ orderId }, ctx) => {
  const invoice = await issueInvoice(orderId);
  ctx.log.info('invoice', { orderId, number: invoice?.number ?? null });
};
