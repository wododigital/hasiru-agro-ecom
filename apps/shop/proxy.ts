import { NextResponse, type NextRequest } from 'next/server';

/**
 * Request proxy (Next 16). Runs before everything else:
 * 1. one 301 to the canonical URL (host, scheme, trailing slash, uppercase path), never a chain;
 * 2. locale header (`/kn` prefix reserved for Kannada, not shipped yet);
 * 3. security headers; strict nonce CSP on dynamic sensitive routes, static CSP elsewhere (A25).
 * Auth here would be optimistic only; real checks live in every server action and route handler.
 */

/** Paths whose case is meaningful (tokens, files, framework assets): never lowercased. */
export const CASE_EXEMPT_PREFIXES = ['/_next/', '/api/', '/media/', '/r/', '/order/', '/feeds/', '/og/'] as const;
/**
 * Machine endpoints, never canonical-redirected: the worker reaches them over the loopback INTERNAL_BASE_URL
 * (revalidation, uptime, mock gateway) and gateways POST webhooks; a 301 turns a POST into a GET.
 */
export const MACHINE_PREFIXES = ['/api/internal/', '/api/health/', '/api/webhooks/', '/api/_mock/'] as const;
/** Dynamic routes that get a per-request nonce CSP. */
export const NONCE_PREFIXES = ['/admin', '/account', '/checkout', '/pay'] as const;

export interface CanonicalTarget {
  /** e.g. "www.example.com"; null leaves host and scheme alone (local dev). */
  host: string | null;
  proto: 'https' | 'http';
}

export function canonicalTargetFromEnv(siteUrl = process.env.SITE_URL): CanonicalTarget {
  if (!siteUrl) return { host: null, proto: 'https' };
  const url = new URL(siteUrl);
  return { host: url.host, proto: url.protocol === 'http:' ? 'http' : 'https' };
}

const startsWithAny = (path: string, prefixes: readonly string[]) =>
  prefixes.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p.endsWith('/') ? p : `${p}/`));

/** The canonical absolute URL for a request, or null when it already is canonical. */
export function canonicalRedirect(
  request: { proto: string; host: string; pathname: string; search: string },
  target: CanonicalTarget,
): string | null {
  let pathname = request.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.replace(/\/+$/, '') || '/';
  if (!startsWithAny(pathname, CASE_EXEMPT_PREFIXES)) {
    // Lowercase letters outside percent-escapes only, so encoded bytes are left as they are.
    pathname = pathname.replace(/%[0-9A-Fa-f]{2}|[^%]+/g, (chunk) => (chunk.startsWith('%') ? chunk : chunk.toLowerCase()));
  }
  const host = target.host ?? request.host;
  const proto = target.host ? target.proto : request.proto;
  if (pathname === request.pathname && host === request.host && proto === request.proto) return null;
  return `${proto}://${host}${pathname}${request.search}`;
}

function contentSecurityPolicy(nonce: string | null, isDev: boolean): string {
  const vendors = (process.env.CSP_VENDOR_SOURCES ?? '').trim();
  const script = nonce
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`
    : `'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}${vendors ? ` ${vendors}` : ''}`;
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${!nonce && vendors ? ` ${vendors}` : ''}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://*.phonepe.com",
  ].join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const proto = (request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')).split(',')[0]!.trim();
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host).split(',')[0]!.trim();
  const target = canonicalTargetFromEnv();

  const redirectTo = startsWithAny(pathname, MACHINE_PREFIXES) ? null : canonicalRedirect({ proto, host, pathname, search }, target);
  if (redirectTo) return NextResponse.redirect(redirectTo, 301);

  const isDev = process.env.NODE_ENV === 'development';
  const nonce = startsWithAny(pathname, NONCE_PREFIXES) ? btoa(crypto.randomUUID()) : null;
  const csp = contentSecurityPolicy(nonce, isDev);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-locale', pathname === '/kn' || pathname.startsWith('/kn/') ? 'kn-IN' : 'en-IN');
  // Layouts and the 404 page cannot read the URL; admin-shell (staff gate) and seo (404 log) read this header.
  requestHeaders.set('x-pathname', pathname);
  if (nonce) {
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', csp);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('permissions-policy', 'geolocation=(self), camera=(), microphone=()');
  response.headers.set('x-frame-options', 'DENY');
  if (target.host && target.proto === 'https') response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
