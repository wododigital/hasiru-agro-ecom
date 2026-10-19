// Pure customer rules: input schemas, masking, segment keys. No React, no Next, no database.
import { normalisePhone } from '@ecomkit/core/ids';
import type { Viewer } from '@ecomkit/core/contracts';
import { z } from 'zod';

export const CONSENT_PURPOSES = ['order_updates', 'marketing', 'analytics_identity'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const LEAD_SOURCES = ['wizard', 'notify_me', 'enquiry', 'chat', 'checkout'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_STATUSES = ['new', 'contacted', 'converted', 'closed'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const CUSTOMER_TYPES = ['farmer', 'business', 'individual'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const SEGMENT_KEYS = ['first_order', 'bulk_buyer', 'by_district', 'wizard_lead_no_order'] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

/** GSTIN: 2-digit state code, PAN (5 letters, 4 digits, 1 letter), entity digit, Z, checksum. */
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PINCODE_RE = /^[1-9]\d{5}$/;

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/** Indian mobile in any common spelling, normalised to E.164 (+91). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const phone = normalisePhone(v);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
      return z.NEVER;
    }
    return phone;
  });

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** Checkbox values from a form post ("on") or booleans from code. */
const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true' || v === '1', z.boolean());
const optionalUuid = z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()).transform((v) => v ?? null);
const optionalNumber = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().optional()).transform((v) => v ?? null);

export const profileInputSchema = z.object({
  displayName: trimmed(120),
  email: z.preprocess((v) => (v === '' ? undefined : v), emailSchema.optional()).transform((v) => v ?? null),
  customerType: z.enum(CUSTOMER_TYPES),
  gstin: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() || undefined : v), z.string().regex(GSTIN_RE, 'invalid_gstin').optional())
    .transform((v) => v ?? null),
  legalName: optionalText(200),
});
export type ProfileInput = z.output<typeof profileInputSchema>;

export const addressInputSchema = z.object({
  id: optionalUuid,
  label: optionalText(40),
  name: trimmed(120),
  phone: phoneSchema,
  line1: trimmed(200),
  line2: optionalText(200),
  landmark: optionalText(200),
  villageTown: optionalText(120),
  pincode: z.string().trim().regex(PINCODE_RE, 'invalid_pincode'),
  districtId: optionalUuid,
  districtText: trimmed(120),
  state: trimmed(80),
  lat: optionalNumber.pipe(z.number().min(-90).max(90).nullable()),
  lng: optionalNumber.pipe(z.number().min(-180).max(180).nullable()),
  isDefault: checkbox.default(false),
});
export type AddressInput = z.output<typeof addressInputSchema>;

export const landInputSchema = z.object({
  id: optionalUuid,
  label: trimmed(80),
  sqft: z.coerce.number().positive().max(1e9),
  districtId: optionalUuid,
  purpose: z
    .preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/).max(60).optional())
    .transform((v) => v ?? null),
  planId: optionalUuid,
});
export type LandInput = z.output<typeof landInputSchema>;

/** Who a consent row belongs to: a signed-in customer, a phone, an email (at least one). */
export const consentSubjectSchema = z
  .object({
    userId: z.uuid().nullish(),
    phone: phoneSchema.nullish(),
    email: emailSchema.nullish(),
  })
  .refine((s) => s.userId || s.phone || s.email, 'subject_required');
export type ConsentSubject = z.input<typeof consentSubjectSchema>;

export const consentInputSchema = z.object({
  subject: consentSubjectSchema,
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
  /** The exact text (and version) the person saw. */
  textShown: trimmed(2000),
  /** Where it was captured: checkout, notify_me, account, banner, admin. */
  source: trimmed(60),
  ipHash: z.string().max(64).nullish(),
  userAgent: z.string().max(400).nullish(),
});
export type ConsentInput = z.input<typeof consentInputSchema>;

export const leadInputSchema = z.object({
  name: trimmed(120),
  phone: phoneSchema,
  source: z.enum(LEAD_SOURCES),
  phoneVerified: z.boolean().default(false),
  userId: z.uuid().nullish(),
  /** `ref` (plan id, enquiry id, product id) makes a repeat from the same phone update the open lead instead of adding one. */
  context: z.record(z.string(), z.unknown()).default({}),
});
export type LeadInput = z.input<typeof leadInputSchema>;

// ---- masking ----------------------------------------------------------------

/** `+91 98•••••210`: country code, first two and last three digits. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '•'.repeat(digits.length);
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  const cc = digits.length > 10 ? `+${digits.slice(0, -10)} ` : '';
  return `${cc}${local.slice(0, 2)}${'•'.repeat(local.length - 5)}${local.slice(-3)}`;
}

/** `r•••@example.com`. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email[0]}•••${email.slice(at)}`;
}

/**
 * Personal data is shown in full only to staff whose role is not `support` (plan section 8) and to the
 * customer themself. Support, guests and other customers get masked values. Fails closed.
 */
export function seesFullPii(viewer: Viewer, ownerUserId?: string | null): boolean {
  if (viewer.kind === 'customer') return !!ownerUserId && viewer.customerId === ownerUserId;
  return viewer.kind === 'staff' && viewer.role !== 'support' && viewer.permissions.includes('customers.read');
}

/** Masks the phone/email fields of a row unless the viewer may see them. */
export function maskPii<T extends { phoneE164?: string | null; phone?: string | null; email?: string | null }>(row: T, viewer: Viewer, ownerUserId?: string | null): T {
  if (seesFullPii(viewer, ownerUserId)) return row;
  const out = { ...row };
  if ('phoneE164' in out) out.phoneE164 = maskPhone(out.phoneE164);
  if ('phone' in out) out.phone = maskPhone(out.phone);
  if ('email' in out) out.email = maskEmail(out.email);
  return out;
}
