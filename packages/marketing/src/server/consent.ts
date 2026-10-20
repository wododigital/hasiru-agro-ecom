import { getViewer } from '@ecomkit/core/auth-context';
import type { ConsentPurpose } from '@ecomkit/core/contracts';
import { clientIp, hashIp, isSameOrigin, PayloadTooLargeError, readRawBody } from '@ecomkit/core/http';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { recordConsent } from '@ecomkit/customers/server';
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SEC, consentRequestSchema, parseConsent, serializeConsent, type ConsentChoice } from '../domain/consent';
import { consentTextShown } from '../messages';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function consentCookie(choice: ConsentChoice, secure: boolean): string {
  return `${CONSENT_COOKIE}=${serializeConsent(choice)}; Path=/; Max-Age=${CONSENT_MAX_AGE_SEC}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/**
 * POST /api/consent `{ analytics, marketing }`: stores the banner choice in a first-party cookie (what the tag
 * loader reads) and, for a signed-in customer, appends `customers_consent` rows for the purposes that changed
 * (analytics -> `analytics_identity`, advertising -> `marketing`). Same-origin only, 1 KB body, 30 per 10 min per IP.
 */
export async function postConsent(req: Request, options: { now?: Date } = {}): Promise<Response> {
  if (!isSameOrigin(req)) return json(403, { ok: false, error: 'forbidden' });
  const ipHash = hashIp(clientIp(req));
  const limit = await rateLimit(`consent:${ipHash ?? 'shared'}`, { limit: 30, windowSec: 600 });
  if (!limit.ok) return json(429, { ok: false, error: 'rate_limited' });
  let raw: unknown;
  try {
    raw = JSON.parse((await readRawBody(req, 1024)).toString('utf8') || 'null');
  } catch (err) {
    return json(err instanceof PayloadTooLargeError ? 413 : 400, { ok: false, error: 'invalid' });
  }
  const parsed = consentRequestSchema.safeParse(raw);
  if (!parsed.success) return json(400, { ok: false, error: 'invalid' });

  const now = options.now ?? new Date();
  const choice: ConsentChoice = { ...parsed.data, at: Math.floor(now.getTime() / 1000) };
  const previous = parseConsent(readCookie(req.headers.get('cookie'), CONSENT_COOKIE));
  const viewer = await getViewer();
  if (viewer.kind === 'customer') {
    const changes: [ConsentPurpose, boolean][] = [];
    if (previous?.analytics !== choice.analytics) changes.push(['analytics_identity', choice.analytics]);
    if (previous?.marketing !== choice.marketing) changes.push(['marketing', choice.marketing]);
    for (const [purpose, granted] of changes) {
      await recordConsent({
        subject: { userId: viewer.userId, phone: viewer.phone, email: viewer.email },
        purpose,
        granted,
        textShown: consentTextShown(),
        source: 'banner',
        ipHash,
        userAgent: req.headers.get('user-agent')?.slice(0, 400) ?? null,
      });
    }
  }
  const secure = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  return json(200, { ok: true, consent: { analytics: choice.analytics, marketing: choice.marketing } }, { 'set-cookie': consentCookie(choice, secure) });
}
