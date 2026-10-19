import { NotFoundError } from '@ecomkit/core/auth-context';
import { formDataToObject } from '@ecomkit/core/validation';
import { ZodError } from 'zod';
import type { ReviewOutcome } from '../messages';
import { ReviewError, submitReview, type UploadedPhoto } from './reviews';

/** Whole multipart body cap (4 photos x 8 MB plus fields). */
const MAX_BODY_BYTES = 34 * 1024 * 1024;

/**
 * POST /api/reviews: the account review form (multipart, works without JS; photos exceed the 1 MB server
 * action body limit, hence a route handler). Answers 303 to /account/reviews?review=<outcome>, or JSON.
 */
export async function handleReviewPost(req: Request): Promise<Response> {
  const wantsJson = (req.headers.get('accept') ?? '').includes('application/json');
  const reply = (outcome: ReviewOutcome, status: number, productId?: string) => {
    if (wantsJson) return Response.json({ ok: outcome === 'sent', outcome }, { status: outcome === 'sent' ? 201 : status });
    const q = new URLSearchParams({ review: outcome });
    if (productId && outcome !== 'sent') q.set('product', productId);
    return new Response(null, { status: 303, headers: { location: `/account/reviews?${q}` } });
  };
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return reply('photos', 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply('invalid', 400);
  }
  const values = formDataToObject(form);
  delete values.photos;
  const productId = typeof values.productId === 'string' && /^[0-9a-f-]{36}$/i.test(values.productId) ? values.productId : undefined;
  const photos: UploadedPhoto[] = [];
  for (const entry of form.getAll('photos')) {
    if (typeof entry === 'string' || entry.size === 0) continue;
    photos.push({ name: entry.name || 'photo', type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) });
  }
  try {
    await submitReview(values, { photos });
    return reply('sent', 201);
  } catch (err) {
    if (err instanceof ZodError) return reply('invalid', 400, productId);
    if (err instanceof ReviewError) return reply(err.code, err.code === 'rate_limited' ? 429 : 400, productId);
    // Not signed in: same 404 as any other customer-only resource.
    if (err instanceof NotFoundError) return wantsJson ? Response.json({ ok: false, outcome: 'not_found' }, { status: 404 }) : new Response(null, { status: 303, headers: { location: '/account/login' } });
    throw err;
  }
}
