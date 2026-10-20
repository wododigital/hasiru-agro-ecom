// CSP sources for the storefront's static policy (A25). The proxy merges these into script-src, connect-src,
// img-src and frame-src; only vendors that are configured (or custom tags that are active) contribute.

export type BuiltInVendor = 'ga4' | 'meta_pixel' | 'google_ads';
export type TagVendor = BuiltInVendor | 'custom';

export interface CspSources {
  script: string[];
  connect: string[];
  img: string[];
  frame: string[];
}

export const VENDOR_CSP: Readonly<Record<BuiltInVendor, CspSources>> = {
  ga4: {
    script: ['https://www.googletagmanager.com'],
    connect: ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
    img: ['https://*.google-analytics.com', 'https://www.googletagmanager.com'],
    frame: [],
  },
  meta_pixel: {
    script: ['https://connect.facebook.net'],
    connect: ['https://www.facebook.com', 'https://connect.facebook.net'],
    img: ['https://www.facebook.com'],
    frame: [],
  },
  google_ads: {
    script: ['https://www.googletagmanager.com', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net'],
    connect: ['https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com'],
    img: ['https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com'],
    frame: ['https://td.doubleclick.net', 'https://www.googletagmanager.com'],
  },
};

/** An https origin, optionally with a leading `*.` label. Keywords, schemes alone, `*`, data: and paths are refused. */
export const CSP_SOURCE_RE = /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{2,5})?$/;

export function emptySources(): CspSources {
  return { script: [], connect: [], img: [], frame: [] };
}

/**
 * Merges the configured vendors and the custom tags' hosts. A custom host is allowed for every directive the
 * tag might need (script, connect, img, frame); invalid entries are dropped, never passed through.
 */
export function cspSourcesFor(vendors: readonly BuiltInVendor[], custom: readonly string[]): CspSources {
  const out = emptySources();
  for (const v of new Set(vendors)) for (const k of Object.keys(out) as (keyof CspSources)[]) out[k].push(...VENDOR_CSP[v][k]);
  const hosts = custom.map((s) => s.trim().toLowerCase()).filter((s) => CSP_SOURCE_RE.test(s));
  for (const k of Object.keys(out) as (keyof CspSources)[]) out[k] = [...new Set([...out[k], ...hosts])].sort();
  return out;
}
