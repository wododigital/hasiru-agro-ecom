import { getViewer, type Viewer } from '@ecomkit/core/auth-context';
import { clientIp, hashIp, PayloadTooLargeError, readRawBody } from '@ecomkit/core/http';
import { rateLimit } from '@ecomkit/core/rate-limit';
import { MAX_BEACON_BYTES } from '../domain/payload';
import { ingest, type HasConsent } from './ingest';
import { readCookie, VISITOR_COOKIE, visitorCookieHeader } from './visitor';

export interface BeaconIngestOptions {
  /** customers' consent lookup; without it no visitor is ever linked to a customer. */
  hasConsent?: HasConsent;
  /** Batches per IP per minute (its own limiter key, never shared with forms). Mobile carriers share IPs, so it is generous. */
  ratePerMinute?: number;
  /** Test seams. */
  getViewer?: () => Promise<Viewer>;
  now?: () => Date;
}

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

/**
 * POST /api/beacon-ingest. Stateless (no CSRF token): cross-site posts are refused by Sec-Fetch-Site, the body is
 * capped before parsing, the IP is rate-limited under `beacon-ingest:<ipHash>`. Always answers 204 for a valid
 * batch and sets the visitor cookie; never cached (a cached Set-Cookie would give every visitor one identity).
 */
export function createBeaconIngest(options: BeaconIngestOptions = {}): (req: Request) => Promise<Response> {
  return async function POST(req) {
    if (req.headers.get('sec-fetch-site') === 'cross-site') return new Response(null, { status: 403, headers: NO_STORE });

    const ipHash = hashIp(clientIp(req)) ?? 'unknown';
    const limit = await rateLimit(`beacon-ingest:${ipHash}`, { limit: options.ratePerMinute ?? 300, windowSec: 60 });
    if (!limit.ok) return new Response(null, { status: 429, headers: { ...NO_STORE, 'retry-after': String(Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)) } });

    let body: unknown;
    try {
      body = JSON.parse((await readRawBody(req, MAX_BEACON_BYTES)).toString('utf8'));
    } catch (err) {
      return new Response(null, { status: err instanceof PayloadTooLargeError ? 413 : 400, headers: NO_STORE });
    }

    const viewer = await (options.getViewer ?? getViewer)();
    const url = new URL(req.url);
    const forwardedProto = req.headers.get('x-forwarded-proto');
    const secure = (forwardedProto ?? url.protocol.replace(':', '')) === 'https';
    const result = await ingest(body, {
      cookie: readCookie(req.headers.get('cookie'), VISITOR_COOKIE),
      userAgent: req.headers.get('user-agent'),
      country: req.headers.get('cf-ipcountry') ?? req.headers.get('x-country'),
      customerId: viewer.kind === 'customer' ? viewer.customerId : null,
      isStaff: viewer.kind === 'staff',
      hasConsent: options.hasConsent,
      siteHost: process.env.SITE_URL ? new URL(process.env.SITE_URL).host : (req.headers.get('x-forwarded-host') ?? url.host),
      now: options.now?.(),
    });
    if (!result.ok) return new Response(null, { status: 400, headers: NO_STORE });
    return new Response(null, { status: 204, headers: { ...NO_STORE, 'set-cookie': visitorCookieHeader(result.cookie, secure) } });
  };
}
