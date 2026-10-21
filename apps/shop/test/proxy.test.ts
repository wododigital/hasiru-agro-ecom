import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalRedirect, proxy } from '../proxy';

// marketing's memoised vendor list (a DB read in the app); here one configured vendor and one custom tag host
vi.mock('@ecomkit/marketing/server', () => ({
  cspSources: async () => ({
    script: ['https://www.googletagmanager.com'],
    connect: ['https://*.google-analytics.com'],
    img: ['https://*.google-analytics.com'],
    frame: ['https://td.doubleclick.net'],
  }),
}));

const target = { host: 'www.example.com', proto: 'https' as const };
const ok = { proto: 'https', host: 'www.example.com', pathname: '/plants', search: '' };

describe('canonicalRedirect (pure)', () => {
  it('leaves a canonical URL alone', () => {
    expect(canonicalRedirect(ok, target)).toBeNull();
    expect(canonicalRedirect({ ...ok, pathname: '/' }, target)).toBeNull();
  });
  it('fixes the host', () => {
    expect(canonicalRedirect({ ...ok, host: 'example.com' }, target)).toBe('https://www.example.com/plants');
  });
  it('fixes the scheme', () => {
    expect(canonicalRedirect({ ...ok, proto: 'http' }, target)).toBe('https://www.example.com/plants');
  });
  it('strips trailing slashes except on the root', () => {
    expect(canonicalRedirect({ ...ok, pathname: '/plants/' }, target)).toBe('https://www.example.com/plants');
    expect(canonicalRedirect({ ...ok, pathname: '/plants//' }, target)).toBe('https://www.example.com/plants');
  });
  it('lowercases the path but keeps the query and percent escapes', () => {
    expect(canonicalRedirect({ ...ok, pathname: '/Plant/Alphonso-Mango', search: '?Ref=X' }, target)).toBe(
      'https://www.example.com/plant/alphonso-mango?Ref=X',
    );
    expect(canonicalRedirect({ ...ok, pathname: '/guides/%E0%B2%AE' }, target)).toBeNull();
  });
  it('fixes everything in one hop', () => {
    expect(canonicalRedirect({ proto: 'http', host: 'example.com', pathname: '/Plants/Timber-Trees/', search: '?page=2' }, target)).toBe(
      'https://www.example.com/plants/timber-trees?page=2',
    );
  });
  it('never lowercases token and asset paths', () => {
    expect(canonicalRedirect({ ...ok, pathname: '/r/AbC123' }, target)).toBeNull();
    expect(canonicalRedirect({ ...ok, pathname: '/api/webhooks/PhonePe' }, target)).toBeNull();
    expect(canonicalRedirect({ ...ok, pathname: '/media/products/Mango.webp' }, target)).toBeNull();
  });
  it('without a pinned host (dev) only normalises the path', () => {
    expect(canonicalRedirect({ proto: 'http', host: 'localhost:3000', pathname: '/plants', search: '' }, { host: null, proto: 'https' })).toBeNull();
    expect(canonicalRedirect({ proto: 'http', host: 'localhost:3000', pathname: '/Plants/', search: '' }, { host: null, proto: 'https' })).toBe(
      'http://localhost:3000/plants',
    );
  });
});

describe('proxy', () => {
  afterEach(() => vi.unstubAllEnvs());
  const request = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

  it.each([
    ['non-canonical host', 'https://example.com/plants', {}],
    ['http', 'http://www.example.com/plants', {}],
    ['trailing slash', 'https://www.example.com/plants/', {}],
    ['uppercase', 'https://www.example.com/Plants', {}],
  ])('301s a %s request to the canonical URL', async (_name, url, headers) => {
    vi.stubEnv('SITE_URL', 'https://www.example.com');
    const res = await proxy(request(url, headers));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://www.example.com/plants');
  });

  it('trusts x-forwarded-proto and x-forwarded-host from nginx', async () => {
    vi.stubEnv('SITE_URL', 'https://www.example.com');
    const res = await proxy(request('http://127.0.0.1:3000/plants', { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'www.example.com' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('never redirects the worker\'s loopback calls to machine endpoints', async () => {
    vi.stubEnv('SITE_URL', 'https://www.example.com');
    expect((await proxy(request('http://127.0.0.1:3000/api/internal/revalidate', {}))).status).toBe(200);
    expect((await proxy(request('http://127.0.0.1:3000/api/health/live', {}))).status).toBe(200);
    expect((await proxy(request('http://127.0.0.1:3000/api/webhooks/phonepe', {}))).status).toBe(200);
    expect((await proxy(request('http://127.0.0.1:3000/plants', {}))).status).toBe(301);
  });

  it('passes the request path to layouts as x-pathname', async () => {
    vi.stubEnv('SITE_URL', 'https://www.example.com');
    const res = await proxy(request('https://www.example.com/admin/products'));
    expect(res.headers.get('x-middleware-request-x-pathname')).toBe('/admin/products');
  });

  it('sets a nonce CSP on checkout and a static CSP on the storefront', async () => {
    vi.stubEnv('SITE_URL', 'https://www.example.com');
    const shop = await proxy(request('https://www.example.com/plants'));
    expect(shop.headers.get('content-security-policy')).toContain("script-src 'self' 'unsafe-inline'");
    const checkout = await proxy(request('https://www.example.com/checkout'));
    const csp = checkout.headers.get('content-security-policy')!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    // Next reads the nonce from the request CSP header and stamps every script it renders for the request
    expect(checkout.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(checkout.headers.get('x-frame-options')).toBe('DENY');
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "default-src 'self'"]) {
      expect(csp).toContain(d);
      expect(shop.headers.get('content-security-policy')).toContain(d);
    }
  });

  it('allows the enabled marketing vendors (and CSP_VENDOR_SOURCES) on storefront and checkout, never on admin', async () => {
    vi.stubEnv('SITE_URL', 'https://www.example.com');
    vi.stubEnv('CSP_VENDOR_SOURCES', 'https://extra.example.org');
    for (const path of ['/plants', '/checkout']) {
      const csp = (await proxy(request(`https://www.example.com${path}`))).headers.get('content-security-policy')!;
      expect(csp).toMatch(/script-src [^;]*https:\/\/www\.googletagmanager\.com [^;]*https:\/\/extra\.example\.org/);
      expect(csp).toContain("connect-src 'self' https://*.google-analytics.com https://extra.example.org");
      expect(csp).toContain("img-src 'self' data: blob: https://*.google-analytics.com");
      expect(csp).toContain("frame-src 'self' https://td.doubleclick.net");
    }
    const admin = (await proxy(request('https://www.example.com/admin/orders'))).headers.get('content-security-policy')!;
    expect(admin).not.toMatch(/googletagmanager|extra\.example|frame-src/);
    expect(admin).toContain("connect-src 'self';");
  });
});
