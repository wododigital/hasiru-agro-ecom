// Pure checkout logic: input schemas, payment choices per COD mode, totals input assembly.
import { z } from 'zod';
import type { AppliedDiscountInput, Paise, ShippingMethodKind, ShippingMethodQuote, TotalsInput } from '@ecomkit/core/contracts';
import { normalisePhone } from '@ecomkit/core/ids';
import { asPaise } from '@ecomkit/core/money';

/** Payments setting (A14): COD is off by default. */
export const COD_MODES = ['online_only', 'partial_advance', 'pay_at_nursery'] as const;
export type CodMode = (typeof COD_MODES)[number];
export const PAYMENT_CHOICES = ['online', 'partial_advance', 'pay_at_nursery'] as const;
export type PaymentChoice = (typeof PAYMENT_CHOICES)[number];

/** Online is always offered; partial advance when that mode is on; pay at the nursery only for pickup. */
export function paymentChoices(mode: CodMode, methodKind: ShippingMethodKind | null): PaymentChoice[] {
  const out: PaymentChoice[] = ['online'];
  if (mode === 'partial_advance' && methodKind !== 'pickup') out.push('partial_advance');
  if (mode === 'pay_at_nursery' && methodKind === 'pickup') out.push('pay_at_nursery');
  return out;
}

/** Online amount under partial advance: `pct` of the total rounded up to the rupee, never above the total. */
export function advanceFor(totalPaise: number, pct: number): Paise {
  if (pct <= 0 || pct >= 100) return asPaise(totalPaise);
  return asPaise(Math.min(totalPaise, Math.ceil((totalPaise * pct) / 100 / 100) * 100));
}

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const opt = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullish());

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const p = normalisePhone(v);
    if (!p) ctx.addIssue({ code: 'custom', message: 'phone' });
    return p ?? '';
  });

export const contactInputSchema = z.object({
  name: z.preprocess(blankToNull, z.string().trim().min(1).max(120).nullish()),
  phone: z.preprocess(blankToNull, phoneSchema.nullish()),
  email: z.preprocess(blankToNull, z.email().max(200).nullish()),
});
export type ContactInput = z.input<typeof contactInputSchema>;

export const addressInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  line1: z.string().trim().min(1).max(200),
  line2: opt(200),
  landmark: opt(200),
  villageTown: opt(120),
  pincode: z.string().trim().regex(/^\d{6}$/),
  district: opt(120),
  districtSlug: z.preprocess(blankToNull, z.string().regex(/^[a-z0-9-]{1,120}$/).nullish()),
  state: opt(80),
  stateCode: z.preprocess(blankToNull, z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullish()),
  farmPin: opt(200),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

/** What a quote needs from the address (partial while the buyer is still typing). */
export const quoteAddressSchema = z.object({
  pincode: z.preprocess(blankToNull, z.string().regex(/^\d{6}$/).nullish()),
  districtSlug: z.preprocess(blankToNull, z.string().regex(/^[a-z0-9-]{1,120}$/).nullish()),
  stateCode: z.preprocess(blankToNull, z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullish()),
});
export const quoteInputSchema = z.object({
  address: quoteAddressSchema.nullish(),
  methodId: z.preprocess(blankToNull, z.string().max(80).nullish()),
});
export type QuoteInput = z.input<typeof quoteInputSchema>;

const checkbox = z.preprocess((v) => v === true || v === 'on' || v === '1' || v === 'true', z.boolean());

export const placeOrderSchema = z
  .object({
    idempotencyKey: z.uuid(),
    name: z.string().trim().min(1).max(120),
    phone: phoneSchema,
    email: z.preprocess(blankToNull, z.email().max(200).nullish()),
    marketingConsent: checkbox.default(false),
    address: addressInputSchema.nullish(),
    methodId: z.string().min(1).max(80),
    slotDate: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()),
    paymentChoice: z.enum(PAYMENT_CHOICES),
    gstin: z.preprocess(blankToNull, z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).nullish()),
    legalName: opt(200),
    policyAck: checkbox.refine((v) => v, 'policy'),
    expectedTotalPaise: z.preprocess(blankToNull, z.coerce.number().int().min(0).nullish()),
  })
  .refine((v) => !v.gstin || !!v.legalName, { path: ['legalName'], message: 'legal_name_required' });
export type PlaceOrderInput = z.input<typeof placeOrderSchema>;

// ---- totals -----------------------------------------------------------------

/** A cart line as checkout sees it (priced by the cart module at read time). */
export interface CheckoutLine {
  lineId: string;
  productId: string;
  variantId: string;
  qty: number;
  kind: 'product' | 'package';
  origin: Record<string, unknown> | null;
  name: string;
  sku: string | null;
  hsn: string | null;
  gstRatePct: number;
  sizeClass: string | null;
  weightKg: number;
  packingFeePaise: number;
  listUnitPaise: number;
  tierUnitPaise: number;
  collectionIds?: readonly string[];
  tagIds?: readonly string[];
}

/** The one place the checkout quote is assembled for `core.computeTotals` (no second pipeline). */
export function totalsInput(input: {
  lines: readonly CheckoutLine[];
  promos: readonly AppliedDiscountInput[];
  coupon: AppliedDiscountInput | null;
  method: Pick<ShippingMethodQuote, 'pricePaise' | 'packingPaise'> | null;
  chargesGstRatePct: number;
  interState: boolean;
}): TotalsInput {
  return {
    lines: input.lines.map((l) => ({
      lineId: l.lineId,
      productId: l.productId,
      variantId: l.variantId,
      qty: l.qty,
      listUnitPaise: asPaise(l.listUnitPaise),
      tierUnitPaise: asPaise(l.tierUnitPaise),
      gstRatePct: l.gstRatePct,
      weightKg: l.weightKg,
    })),
    automaticPromos: input.promos,
    coupon: input.coupon,
    packingPaise: asPaise(input.method?.packingPaise ?? 0),
    transportPaise: asPaise(input.method?.pricePaise ?? 0),
    chargesGstRatePct: input.chargesGstRatePct,
    interState: input.interState,
  };
}

/** Lines merged per variant for a stock hold (a variant can sit in the package and as an extra line). */
export function reserveLines(lines: readonly Pick<CheckoutLine, 'variantId' | 'qty'>[]): { variantId: string; qty: number }[] {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.variantId, (m.get(l.variantId) ?? 0) + l.qty);
  return [...m].map(([variantId, qty]) => ({ variantId, qty }));
}

/** Without the shipping module the store offers pickup only, free. */
export const PICKUP_ONLY: ShippingMethodQuote = {
  methodId: 'pickup',
  kind: 'pickup',
  available: true,
  unavailableReason: null,
  pricePaise: asPaise(0),
  packingPaise: asPaise(0),
  vehicle: null,
  distanceKm: null,
  slots: [],
  promise: null,
};

/** Text recorded with every consent row; bump the version when the copy changes. */
export const CONSENT_VERSION = '2026-10';

/** `Saturday 24 Oct` for a YYYY-MM-DD delivery date. */
export function slotLabel(day: string): string {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).formatToParts(new Date(`${day}T00:00:00Z`));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

/** Checkout settings (admin-shell renders the form). */
export const checkoutSettingsSchema = z.object({
  chargesGstRatePct: z
    .number()
    .min(0)
    .max(28)
    .default(18)
    .meta({ group: 'Tax', help: 'GST rate included in packing and delivery charges (shown as included, split on the invoice).' }),
  sessionDays: z.number().int().min(1).max(60).default(7).meta({ group: 'Checkout', help: 'How long an unfinished checkout keeps its contact and address.' }),
});
