import { clientIp, hashIp } from '@ecomkit/core/http';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { formDataToObject, formGuards } from '@ecomkit/core/validation';
import { pickUtm, safeReturnPath, farmDevelopmentSchema } from '../domain';
import { AttachmentError, createEnquiry } from './enquiries';
import type { StoredFile } from './ports';

/** Whole multipart body cap (5 files x 10 MB plus fields); nginx caps uploads at 12 MB per request upstream. */
const MAX_BODY_BYTES = 52 * 1024 * 1024;
/** Plan section 8: enquiry 5 per IP per hour. */
const LIMIT = { limit: 5, windowSec: 3600 };

export type EnquiryOutcome = 'sent' | 'invalid' | 'retry' | 'rate_limited' | 'attachment';

/**
 * POST /api/enquiry. A plain HTML form posts here (multipart, no JS needed) and gets a 303 back to the page
 * it came from with `?enquiry=<outcome>`; a fetch with `Accept: application/json` gets JSON instead.
 * Order: rate limit -> spam guards (a honeypot hit looks like success and stores nothing) -> zod -> files -> save.
 */
export async function handleEnquiryPost(req: Request): Promise<Response> {
  const wantsJson = (req.headers.get('accept') ?? '').includes('application/json');
  let back = '/';
  const reply = (outcome: EnquiryOutcome, status: number, extra: Record<string, unknown> = {}) => {
    if (wantsJson) return Response.json({ ok: outcome === 'sent', outcome, ...extra }, { status: outcome === 'sent' ? 201 : status });
    const url = new URL(back, 'http://local');
    url.searchParams.set('enquiry', outcome);
    return new Response(null, { status: 303, headers: { location: `${url.pathname}${url.search}#enquiry` } });
  };

  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return reply('attachment', 413);

  const ipHash = hashIp(clientIp(req));
  const limited = await rateLimit(`enquiry:${ipHash ?? 'unknown'}`, LIMIT);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply('invalid', 400);
  }
  back = safeReturnPath(form.get('_return'));
  if (!limited.ok) return reply('rate_limited', 429);

  const guard = formGuards.check(form);
  if (!guard.ok) return guard.reason === 'honeypot' ? reply('sent', 201) : reply('retry', 400);

  const values = formDataToObject(form);
  const parsed = farmDevelopmentSchema.safeParse(values);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')))];
    return reply('invalid', 400, { fields });
  }

  const files: StoredFile[] = [];
  for (const entry of form.getAll('files')) {
    if (typeof entry === 'string' || entry.size === 0) continue;
    files.push({ name: entry.name || 'file', type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) });
  }

  try {
    const { enquiryId } = await createEnquiry(parsed.data, { files, ipHash, sourcePath: back.split(/[?#]/)[0] ?? '/', utm: pickUtm(values) });
    return reply('sent', 201, { enquiryId });
  } catch (err) {
    if (err instanceof AttachmentError) return reply('attachment', 400, { code: err.code });
    throw err;
  }
}
