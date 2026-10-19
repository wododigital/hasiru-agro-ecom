import sanitizeHtml from 'sanitize-html';
import { z, type ZodType } from 'zod';
import { ForbiddenError, NotFoundError, requirePermission } from '../auth-context';
import type { Permission } from '../contracts';
import { signInternal, verifyInternal } from '../http/hmac';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors: Record<string, string[]>; formError?: 'forbidden' | 'not_found' | 'invalid' };

/** FormData to a plain object: repeated keys become arrays, files are kept, empty strings stay (zod decides). */
export function formDataToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith('$ACTION')) continue; // Next's internal fields
    const prev = out[key];
    out[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

/**
 * Wraps a server action: parses input (FormData or object) with `schema`, checks `permission` when given,
 * and returns `{ ok, data } | { ok: false, fieldErrors }` instead of throwing. Permission and ownership
 * failures come back as formError so the form can say so; other errors propagate (and get captured).
 */
export function zodAction<S extends ZodType, T>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<T>,
  options: { permission?: Permission } = {},
): (input: FormData | z.input<S>) => Promise<ActionResult<T>> {
  return async (input) => {
    try {
      if (options.permission) await requirePermission(options.permission);
      const parsed = schema.safeParse(input instanceof FormData ? formDataToObject(input) : input);
      if (!parsed.success) {
        const flat = z.flattenError(parsed.error);
        return { ok: false, fieldErrors: flat.fieldErrors as Record<string, string[]>, ...(flat.formErrors.length ? { formError: 'invalid' as const } : {}) };
      }
      return { ok: true, data: await handler(parsed.data) };
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false, fieldErrors: {}, formError: 'forbidden' };
      if (err instanceof NotFoundError) return { ok: false, fieldErrors: {}, formError: 'not_found' };
      throw err;
    }
  };
}

const HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small',
    'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    col: ['span'],
    colgroup: ['span'],
  },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https', 'http'] },
  allowProtocolRelative: false,
  // Keep empty table cells: they hold table layout.
  exclusiveFilter: () => false,
  transformTags: {
    // An author's rel (nofollow, sponsored) is kept; new-tab links also get noopener noreferrer.
    a: (tagName, attribs) => {
      if (attribs.target !== '_blank') return { tagName, attribs };
      const rel = new Set((attribs.rel ?? '').split(/\s+/).filter(Boolean));
      rel.add('noopener');
      rel.add('noreferrer');
      return { tagName, attribs: { ...attribs, rel: [...rel].join(' ') } };
    },
  },
};

/** The one rich-text sanitiser: run on save and trust nothing else. Keeps headings, tables, links with rel, images. */
export function safeHtml(html: string): string {
  return sanitizeHtml(html, HTML_OPTIONS);
}

/** Spam guards for public forms that work without JS: a honeypot field and a signed render-time token. */
export const formGuards = {
  honeypotField: 'website',
  timeField: '_ft',
  /** Hidden-field value to render with the form. */
  issue(now = Date.now()): string {
    const ts = String(now);
    return `${ts}.${signInternal(ts, 'form-time')}`;
  },
  /** Too fast (< minMs, default 2 s) or too old (> 24 h) or forged: rejected. */
  check(values: Record<string, unknown> | FormData, options: { now?: number; minMs?: number } = {}): { ok: true } | { ok: false; reason: 'honeypot' | 'token' | 'too_fast' | 'expired' } {
    const get = (k: string) => (values instanceof FormData ? values.get(k) : values[k]);
    const honey = get(formGuards.honeypotField);
    if (typeof honey === 'string' && honey.trim() !== '') return { ok: false, reason: 'honeypot' };
    const token = get(formGuards.timeField);
    const [ts, sig] = typeof token === 'string' ? token.split('.') : [];
    if (!ts || !sig || !verifyInternal(ts, sig, 'form-time')) return { ok: false, reason: 'token' };
    const age = (options.now ?? Date.now()) - Number(ts);
    if (age < (options.minMs ?? 2000)) return { ok: false, reason: 'too_fast' };
    if (age > 86_400_000) return { ok: false, reason: 'expired' };
    return { ok: true };
  },
};
