import { z } from 'zod';
import { CSP_SOURCE_RE } from './csp';

export const TAG_VENDORS = ['ga4', 'meta_pixel', 'google_ads', 'custom'] as const;
export const TAG_PLACEMENTS = ['head', 'body_end'] as const;
export const TAG_SCOPES = ['all', 'paths'] as const;

const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true' || v === '1', z.boolean());
const lines = (re: RegExp, message: string, max: number) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\s,]+/)).map((s) => String(s).trim()).filter(Boolean),
    z.array(z.string().regex(re, message)).max(max),
  );

/** Admin form input for a custom tag. */
export const tagInputSchema = z
  .object({
    id: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
    name: z.string().trim().min(2).max(80),
    vendor: z.enum(TAG_VENDORS).default('custom'),
    placement: z.enum(TAG_PLACEMENTS).default('body_end'),
    scope: z.enum(TAG_SCOPES).default('all'),
    paths: lines(/^\/[A-Za-z0-9/_\-.]*$/, 'paths start with /', 50),
    snippet: z.string().trim().min(1).max(20_000),
    cspSources: lines(CSP_SOURCE_RE, 'an https origin such as https://cdn.example.com', 20),
    requiresConsent: checkbox,
    isActive: checkbox,
  })
  .refine((t) => t.scope === 'all' || t.paths.length > 0, { message: 'add at least one path', path: ['paths'] });
export type TagInput = z.output<typeof tagInputSchema>;

/** Whether a tag runs on `path`: everywhere, or under one of its path prefixes (segment-aligned). */
export function tagAppliesTo(tag: { scope: 'all' | 'paths'; paths: readonly string[] }, path: string): boolean {
  if (tag.scope === 'all') return true;
  return tag.paths.some((p) => {
    const prefix = p.replace(/\/+$/, '') || '/';
    return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
  });
}

export interface CustomTagConfig {
  id: string;
  placement: 'head' | 'body_end';
  scope: 'all' | 'paths';
  paths: string[];
  snippet: string;
  requiresConsent: boolean;
}

/** Everything the browser tag loader needs. Public identifiers only; no secret ever enters this object. */
export interface PublicTagConfig {
  banner: boolean;
  ga4: string | null;
  metaPixel: string | null;
  ads: { id: string; purchaseLabel: string | null; enhanced: boolean } | null;
  custom: CustomTagConfig[];
}
