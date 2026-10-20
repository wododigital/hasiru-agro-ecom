import type { AppliedDiscountInput, InventoryOps, Paise, ShippingQuoter } from '@ecomkit/core/contracts';
import type { Tx } from '@ecomkit/core/db';
import { defineSettings } from '@ecomkit/core/settings';
import { checkoutSettingsSchema, type CheckoutLine, type CodMode } from '../domain';

export const checkoutSettings = defineSettings('checkout', checkoutSettingsSchema);

export interface CheckoutCart {
  id: string;
  customerId: string | null;
  couponCode: string | null;
  lines: readonly CheckoutLine[];
}

/** The order the place-order transaction asks the orders module to create (shape of orders `createOrder`). */
export interface CheckoutOrderInput {
  customerId: string | null;
  contact: { name: string; phone: string | null; email: string | null };
  shippingAddress: Record<string, unknown> | null;
  billing: { gstin: string; legalName: string } | null;
  delivery: { methodId: string; kind: 'pickup' | 'local_slot' | 'outstation' | 'enquiry_only'; label: string | null; slotDate: string | null; vehicle: string | null; km: number | null; promise: { earliest: string; latest: string } | null };
  lines: {
    variantId: string;
    productId: string;
    snapshot: { name: string; sku: string | null; hsn: string | null; gstRatePct: number; sizeClass: string | null; weightKg: number };
    qty: number;
    listUnitPaise: number;
    unitPaise: number;
    tierApplied: boolean;
    discountPaise: number;
    taxPaise: number;
    lineTotalPaise: number;
    kind: 'product' | 'package';
    origin: Record<string, unknown> | null;
  }[];
  totals: {
    subtotalPaise: number;
    tierSavingsPaise: number;
    promoPaise: number;
    couponPaise: number;
    packingPaise: number;
    shippingPaise: number;
    taxPaise: number;
    totalPaise: number;
    weightKg: number;
    chargesGstRatePct: number;
    breakdown: Record<string, unknown>;
  };
  source: 'web';
  paymentMode: 'online' | 'partial_advance' | 'pay_at_nursery';
  advancePaise: number;
  initialStatus: 'pending_payment' | 'confirmed';
  reservationId: string | null;
  attribution: Record<string, unknown> | null;
  isTest: boolean;
}

export interface CheckoutOrderSummary {
  id: string;
  number: string;
  status: string;
  totalPaise: number;
  advancePaise: number;
  paidPaise: number;
  contact: { name: string; phone: string | null; email: string | null };
}

export interface CouponCheck {
  ok: boolean;
  ruleId?: string;
  codeId?: string;
  discount?: AppliedDiscountInput;
  reason?: string;
}

/**
 * Everything checkout reaches in other modules. The host binds these at boot (`configureCheckout`) from the
 * registry and the modules' public server APIs; optional ones may stay null and the feature degrades:
 * no shipping means pickup only, no inventory means no stock hold, no discounts means no promos or coupon.
 * `cart`, `orders` and `payments` are required to place an order.
 */
export interface CheckoutPorts {
  cart: {
    /** The viewer's active cart (cookie), priced now; null when there is none or it is empty. */
    current(): Promise<CheckoutCart | null>;
    /** Marks the cart converted inside the place-order transaction. */
    markConverted(cartId: string, orderId: string, options: { tx: Tx }): Promise<void>;
    /** Marks the cart as having a contact (abandoned-cart `hasContact`) inside the contact autosave transaction. */
    noteContact(cartId: string, options: { tx: Tx }): Promise<void>;
  } | null;
  orders: {
    createOrder(input: CheckoutOrderInput, options: { tx: Tx }): Promise<{ id: string; number: string; guestToken: string }>;
    /** Same signed token createOrder returned, for a replayed submit. */
    guestToken(orderId: string): string;
    /** Seller state code for CGST + SGST vs IGST (orders settings). */
    sellerStateCode(): Promise<string>;
    /** The order for its buyer (guest token or the signed-in owner), else null. */
    forBuyer(orderId: string, token: string | null): Promise<CheckoutOrderSummary | null>;
  } | null;
  payments: {
    config(): Promise<{ codMode: CodMode; advancePct: number; attemptExpiryMinutes: number }>;
    /** Starts an online payment for the amount; returns where to send the buyer (null for offline flows). */
    start(input: {
      orderId: string;
      orderNumber: string;
      amountPaise: Paise;
      customer: { name: string | null; phone: string | null; email: string | null };
      returnPath: string;
    }): Promise<{ redirectUrl: string | null }>;
  } | null;
  inventory: (() => Promise<Pick<InventoryOps, 'reserve' | 'commit' | 'release'> | null>) | null;
  shipping: (() => Promise<ShippingQuoter | null>) | null;
  discounts: {
    promos(lines: readonly CheckoutLine[], ctx: { customerId: string | null }): Promise<AppliedDiscountInput[]>;
    coupon(code: string, lines: readonly CheckoutLine[], ctx: { subject: string; phone: string | null; customerId: string | null }): Promise<CouponCheck>;
    /** Records uses in the order transaction; throws when a limit was reached meanwhile. */
    redeem(input: { orderId: string; customerId: string | null; phone: string | null; discounts: { ruleId: string; codeId: string | null; amountPaise: number }[] }, options: { tx: Tx }): Promise<void>;
  } | null;
  /** States for the address form (places). Without it the state is free text and tax is intra-state. */
  regions: { states(): Promise<{ code: string; name: string }[]> } | null;
  /** UTM / click ids captured by marketing, copied onto the order. */
  attribution: (() => Promise<Record<string, unknown> | null>) | null;
}

// On globalThis: instrumentation (boot) and route bundles are separate module instances in Next.
const ports: CheckoutPorts = ((globalThis as Record<symbol, CheckoutPorts | undefined>)[Symbol.for('ecomkit.checkout.ports')] ??= { cart: null, orders: null, payments: null, inventory: null, shipping: null, discounts: null, regions: null, attribution: null });
export const getCheckoutPorts = (): Readonly<CheckoutPorts> => ports;
export function configureCheckout(next: Partial<CheckoutPorts>): void {
  Object.assign(ports, next);
}
