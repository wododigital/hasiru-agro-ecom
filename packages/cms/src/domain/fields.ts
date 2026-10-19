import { SLUG_RE } from '@ecomkit/core/ids';
import { z } from 'zod';

export { SLUG_RE };

/**
 * One description of an editable field, used by the block editor, the menu editor and every admin form, so a new
 * block type or content type is a schema plus a field list, never a new form component.
 */
export type FieldKind = 'text' | 'textarea' | 'html' | 'url' | 'number' | 'checkbox' | 'media' | 'media-list' | 'select' | 'datetime' | 'items';

export interface FieldSpec {
  name: string;
  /** Admin copy (admin UI is English-only). */
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  options?: readonly { value: string; label: string }[];
  /** For `items`: the fields of each row. */
  fields?: readonly FieldSpec[];
}

/** Form JSON (editor islands post a hidden JSON field): parsed, or left as the raw string so validation fails cleanly. */
export const jsonInput = (v: unknown): unknown => {
  if (typeof v !== 'string') return v ?? [];
  if (!v.trim()) return [];
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

/** Empty form input ('' or missing) becomes undefined, so optional fields stay out of stored JSON. */
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const reqText = (max = 200) => z.string().trim().min(1).max(max);
export const optText = (max = 500) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
export const optUuid = z.preprocess(blankToUndefined, z.uuid().optional());
export const optInt = (min: number, max: number) => z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional());
export const optNumber = (min: number, max: number) => z.preprocess(blankToUndefined, z.coerce.number().min(min).max(max).optional());
export const position = z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(100_000).default(0));
export const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true' || v === '1', z.boolean());
export const publishStatus = z.enum(['draft', 'published']).default('draft');
export const slug = z.string().trim().toLowerCase().regex(SLUG_RE, 'lowercase letters, numbers and hyphens').max(120);

/**
 * A link target: a site path, an https URL, or a tel:, mailto: or WhatsApp link. Nothing that can run script.
 */
export const href = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/(?!\/)[^\s]*$/.test(v) || /^https:\/\/[^\s]+$/i.test(v) || /^(tel:\+?[\d\s-]+|mailto:[^\s@]+@[^\s@]+)$/i.test(v), 'a path starting with /, an https link, tel: or mailto:');

export const isExternalHref = (v: string) => !v.startsWith('/');

/** `datetime-local` input values are Asia/Kolkata wall time. */
export function istLocalToDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const d = new Date(`${value.length === 16 ? `${value}:00` : value}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateToIstLocal(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

export const istDateTime = z.preprocess(blankToUndefined, z.string().optional()).transform((v, ctx) => {
  if (v === undefined) return null;
  const d = istLocalToDate(v);
  if (!d) {
    ctx.addIssue({ code: 'custom', message: 'not a date and time' });
    return z.NEVER;
  }
  return d;
});
