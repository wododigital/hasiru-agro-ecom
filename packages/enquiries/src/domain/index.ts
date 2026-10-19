// Pure enquiry rules: the form schema, the pipeline, staleness. No React, no Next, no database.
import { normalisePhone } from '@ecomkit/core/ids';
import { z } from 'zod';

export const ENQUIRY_KINDS = ['farm_development', 'bulk_quote', 'general', 'contact'] as const;
export type EnquiryKind = (typeof ENQUIRY_KINDS)[number];

/** Pipeline order. Staff may move an enquiry to any other status (boards are dragged both ways). */
export const ENQUIRY_STATUSES = ['new', 'contacted', 'site_assessment', 'design', 'quotation', 'project', 'closed_won', 'closed_lost'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export const CLOSED_STATUSES: readonly EnquiryStatus[] = ['closed_won', 'closed_lost'];

export const ENQUIRY_CUSTOMER_TYPES = ['farmer', 'business', 'individual'] as const;

/** Upload limits for the public form. The media store sniffs bytes; these are the boundary caps. */
export const ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxBytes: 10 * 1024 * 1024,
  types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'] as readonly string[],
};

/** An open enquiry untouched for this many days is flagged stale in the pipeline. */
export const STALE_AFTER_DAYS = 3;
/** The dashboard tile turns amber when the newest enquiry is older than this (plan section 7). */
export const QUIET_AFTER_DAYS = 7;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const blankToUndefined = (v: unknown) => (v === '' || v == null ? undefined : v);

/** The public enquiry form (field names are the form's input names). */
export const enquiryFormSchema = z.object({
  kind: z.preprocess(blankToUndefined, z.enum(ENQUIRY_KINDS).default('general')),
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const p = normalisePhone(v);
      if (!p) {
        ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
        return z.NEVER;
      }
      return p;
    }),
  email: z.preprocess(blankToUndefined, z.string().trim().toLowerCase().pipe(z.email()).optional()).transform((v) => v ?? null),
  customerType: z.preprocess(blankToUndefined, z.enum(ENQUIRY_CUSTOMER_TYPES).optional()).transform((v) => v ?? null),
  acres: z.preprocess(blankToUndefined, z.coerce.number().min(1).max(100_000).optional()).transform((v) => v ?? null),
  location: text(200),
  districtId: z.preprocess(blankToUndefined, z.uuid().optional()).transform((v) => v ?? null),
  timeline: text(80),
  requirement: text(4000),
  notes: text(4000),
});
export type EnquiryFormInput = z.output<typeof enquiryFormSchema>;

/** Farm development needs the land size and where it is; other kinds need only a message. */
export const farmDevelopmentSchema = enquiryFormSchema.superRefine((v, ctx) => {
  if (v.kind !== 'farm_development') {
    if (!v.requirement) ctx.addIssue({ code: 'custom', path: ['requirement'], message: 'required' });
    return;
  }
  if (v.acres == null) ctx.addIssue({ code: 'custom', path: ['acres'], message: 'required' });
  if (!v.location && !v.districtId) ctx.addIssue({ code: 'custom', path: ['location'], message: 'required' });
});

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const;

/** Picks UTM and click ids from any record (form values or search params), trimmed and capped. */
export function pickUtm(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = values[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}

/** Only same-site relative paths ("/x", not "//host" or "/\host"); anything else falls back to "/". */
export function safeReturnPath(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])[^\s\\]*$/.test(value) && value.length <= 300 ? value : '/';
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** An open enquiry not updated for STALE_AFTER_DAYS. */
export function isStale(e: { status: EnquiryStatus; updatedAt: Date }, now: Date): boolean {
  return !CLOSED_STATUSES.includes(e.status) && daysBetween(e.updatedAt, now) >= STALE_AFTER_DAYS;
}

/** "Last enquiry N days ago" tile: amber after QUIET_AFTER_DAYS, and when there has never been one. */
export function quietness(lastAt: Date | null, now: Date): { days: number | null; level: 'ok' | 'amber' } {
  if (!lastAt) return { days: null, level: 'amber' };
  const days = daysBetween(lastAt, now);
  return { days, level: days > QUIET_AFTER_DAYS ? 'amber' : 'ok' };
}
