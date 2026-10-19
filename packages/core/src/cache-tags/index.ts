import { signInternal } from '../http/hmac';

/** The only cache tags in the system. Builders keep the `<kind>:<key>` spelling in one place. */
export const tags = {
  catalog: 'catalog',
  nav: 'nav',
  home: 'home',
  promoActive: 'promo:active',
  product: (id: string) => `product:${id}`,
  price: (id: string) => `price:${id}`,
  stock: (id: string) => `stock:${id}`,
  category: (slug: string) => `category:${slug}`,
  cms: (slug: string) => `cms:${slug}`,
  settings: (moduleId: string) => `settings:${moduleId}`,
  model: (slug: string) => `model:${slug}`,
  reviews: (productId: string) => `reviews:${productId}`,
  district: (slug: string) => `district:${slug}`,
} as const;

export const TAG_RE = /^(catalog|nav|home|promo:active|(product|price|stock|category|cms|settings|model|reviews|district):[A-Za-z0-9_-]+)$/;

export const REVALIDATE_PATH = '/api/internal/revalidate';
export const SIGNATURE_HEADER = 'x-ecomkit-signature';

/** Body signed for the internal revalidate endpoint. The timestamp bounds replay to 5 minutes. */
export function revalidateRequest(tagList: readonly string[], now = Date.now()): { body: string; signature: string } {
  const body = JSON.stringify({ tags: tagList, ts: now });
  return { body, signature: signInternal(body, 'revalidate') };
}

/** From the worker (no Next request context): POST the tags to the web process over localhost. */
export async function revalidateFromWorker(tagList: readonly string[]): Promise<void> {
  if (!tagList.length) return;
  const base = process.env.INTERNAL_BASE_URL ?? 'http://127.0.0.1:3000';
  const { body, signature } = revalidateRequest(tagList);
  const res = await fetch(new URL(REVALIDATE_PATH, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signature },
    body,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`revalidate failed with ${res.status}`);
}

/**
 * Expire tags from anywhere: inside Next (server action, route handler) it calls revalidateTag directly;
 * elsewhere (worker, scripts, tests) it posts to the web process, and a missing web process is not an error.
 */
export async function invalidateTags(tagList: readonly string[]): Promise<void> {
  if (!tagList.length) return;
  try {
    const { revalidateTag } = await import('next/cache');
    for (const tag of tagList) revalidateTag(tag, { expire: 0 });
    return;
  } catch {
    // not inside a Next request
  }
  try {
    await revalidateFromWorker(tagList);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ level: 'warn', scope: 'cache-tags', message: 'revalidate skipped', tags: tagList, error: String(err) })}\n`);
  }
}
