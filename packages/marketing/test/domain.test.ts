import { describe, expect, it } from 'vitest';
import {
  allowedBy,
  capiBodySchema,
  capiTimeIssue,
  consentMode,
  cspSourcesFor,
  fbcFrom,
  gaClientId,
  ga4BodySchema,
  ga4Purchase,
  metaNormalise,
  parseConsent,
  sanitiseClicks,
  sanitiseTouch,
  serializeConsent,
  tagAppliesTo,
  tagInputSchema,
  touchFromUrl,
  VENDOR_CSP,
} from '../src/domain';
import { order } from './helpers';

describe('consent cookie and Consent Mode', () => {
  it('round-trips and rejects anything else', () => {
    const c = { analytics: true, marketing: false, at: 1_760_000_000 };
    expect(serializeConsent(c)).toBe('a1.m0.1760000000');
    expect(parseConsent('a1.m0.1760000000')).toEqual(c);
    for (const bad of ['', 'a2.m0.1', 'a1.m0', 'a1.m0.1;x', '{"analytics":true}']) expect(parseConsent(bad)).toBeNull();
  });

  it('denies everything until a choice exists and maps each toggle to its signals', () => {
    expect(consentMode(null)).toEqual({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    expect(consentMode({ analytics: true, marketing: false, at: 1 })).toEqual({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
    expect(consentMode({ analytics: false, marketing: true, at: 1 }).ad_user_data).toBe('granted');
    expect(allowedBy(null, 'marketing')).toBe(false);
    expect(allowedBy(null, 'none')).toBe(true);
  });
});

describe('CSP sources', () => {
  it('lists only configured vendors and valid custom https origins', () => {
    expect(cspSourcesFor([], [])).toEqual({ script: [], connect: [], img: [], frame: [] });
    const s = cspSourcesFor(['meta_pixel'], ['https://cdn.example.com', "'unsafe-eval'", '*', 'http://plain.example.com', 'data:', 'https://x.example.com/path', 'https://*.tags.example.net']);
    expect(s.script).toEqual(['https://*.tags.example.net', 'https://cdn.example.com', ...VENDOR_CSP.meta_pixel.script].sort());
    expect(s.connect).toContain('https://www.facebook.com');
    expect(JSON.stringify(s)).not.toMatch(/unsafe|http:\/\/|data:|\/path/);
    expect(s.script).not.toContain('https://www.googletagmanager.com');
  });
});

describe('attribution', () => {
  it('captures utm and click ids, ignores internal navigation', () => {
    const { touch, clicks } = touchFromUrl(new URL('https://shop.example/plant/x?utm_source=news&utm_medium=email&utm_campaign=oct&gclid=Cj0.abc-1'), null, 1000);
    expect(touch).toMatchObject({ source: 'news', medium: 'email', campaign: 'oct', landingPath: '/plant/x', at: 1000 });
    expect(clicks).toEqual({ gclid: 'Cj0.abc-1' });
    expect(touchFromUrl(new URL('https://shop.example/cart'), 'https://shop.example/plants', 1).touch).toBeNull();
    expect(touchFromUrl(new URL('https://shop.example/?fbclid=IwAR1'), null, 5).touch).toMatchObject({ source: 'facebook', medium: 'paid_social' });
    expect(touchFromUrl(new URL('https://shop.example/'), 'https://www.search.example/q', 5).touch).toMatchObject({ source: 'www.search.example', medium: 'referral' });
    expect(touchFromUrl(new URL('https://shop.example/?gclid=<script>'), null, 5).clicks).toEqual({});
  });

  it('builds fbc and reads the GA client id', () => {
    expect(fbcFrom('IwAR1', 1_760_000_000_123)).toBe('fb.1.1760000000123.IwAR1');
    expect(gaClientId('GA1.1.123456789.1760000000')).toBe('123456789.1760000000');
    expect(gaClientId('junk')).toBeNull();
  });

  it('sanitises client-controlled cookie values', () => {
    expect(sanitiseTouch({ source: 'x'.repeat(500), at: 'nope', evil: 1 })).toMatchObject({ source: 'x'.repeat(150), at: 0 });
    expect(sanitiseTouch('str')).toBeNull();
    expect(sanitiseClicks({ gclid: 'ok_1', fbclid: 'bad value' })).toMatchObject({ gclid: 'ok_1', fbclid: null });
  });
});

describe('tags', () => {
  it('validates the admin form and refuses unsafe CSP entries', () => {
    const ok = tagInputSchema.parse({ name: 'Heatmap', snippet: '<script src="https://cdn.example.com/h.js"></script>', cspSources: 'https://cdn.example.com\nhttps://api.example.com', scope: 'paths', paths: '/plants\n/checkout', isActive: 'on' });
    expect(ok).toMatchObject({ vendor: 'custom', requiresConsent: false, isActive: true, cspSources: ['https://cdn.example.com', 'https://api.example.com'], paths: ['/plants', '/checkout'] });
    expect(tagInputSchema.safeParse({ name: 'Bad', snippet: 'x', cspSources: "'unsafe-inline'" }).success).toBe(false);
    expect(tagInputSchema.safeParse({ name: 'No paths', snippet: 'x', scope: 'paths', paths: '' }).success).toBe(false);
  });

  it('matches path scopes on segment boundaries', () => {
    const t = { scope: 'paths' as const, paths: ['/checkout'] };
    expect(tagAppliesTo(t, '/checkout')).toBe(true);
    expect(tagAppliesTo(t, '/checkout/123/pay')).toBe(true);
    expect(tagAppliesTo(t, '/checkouts')).toBe(false);
    expect(tagAppliesTo({ scope: 'all', paths: [] }, '/anything')).toBe(true);
  });
});

describe('conversion payloads', () => {
  it('normalises contact data the way Meta specifies before hashing', () => {
    expect(metaNormalise.email(' Buyer@Example.COM ')).toBe('buyer@example.com');
    expect(metaNormalise.phone('+91 98450-12345')).toBe('919845012345');
    expect(metaNormalise.name(" D'Souza ")).toBe('dsouza');
    expect(metaNormalise.city('New Town 2')).toBe('newtown');
    expect(metaNormalise.zip('560 001')).toBe('560001');
    expect(metaNormalise.country('IN')).toBe('in');
    expect(metaNormalise.email('not-an-email')).toBeNull();
  });

  it('GA4 purchase carries transaction_id, value and items and passes the MP schema', () => {
    const o = order();
    const body = ga4Purchase(o, { clientId: '1.2', marketingConsent: false, nowMs: 1_760_000_000_000 });
    expect(ga4BodySchema.safeParse(body).success).toBe(true);
    expect(body.events[0]!.params).toMatchObject({ transaction_id: o.orderNumber, value: 2499, currency: 'INR', tax: 119 });
    expect(body.consent).toEqual({ ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
    const noTxn = { ...body, events: [{ name: 'purchase', params: { value: 1, currency: 'INR' } }] };
    expect(ga4BodySchema.safeParse(noTxn).success).toBe(false);
  });

  it('the CAPI schema refuses unhashed identifiers and events outside the time window', () => {
    const event = { event_name: 'Purchase', event_time: 1_760_000_000, action_source: 'website', event_source_url: 'https://shop.example/x', user_data: { em: ['buyer@example.com'], client_user_agent: 'UA' } };
    expect(capiBodySchema.safeParse({ data: [event] }).success).toBe(false);
    expect(capiBodySchema.safeParse({ data: [{ ...event, user_data: { em: ['a'.repeat(64)], client_user_agent: 'UA' } }] }).success).toBe(true);
    expect(capiTimeIssue(1_760_000_000, 1_760_000_000 + 8 * 86_400)).toMatch(/7 days/);
    expect(capiTimeIssue(1_760_000_000 + 600, 1_760_000_000)).toMatch(/future/);
    expect(capiTimeIssue(1_760_000_000, 1_760_000_100)).toBeNull();
  });
});
