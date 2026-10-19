import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';
import { newId, normalisePhone, slugify, SLUG_RE } from '../src/ids';
import { financialYear } from '../src/sequence';
import { isPublicAddress, safeFetch, signHmacSha256, SsrfError, timingSafeEqual, verifyHmacSha256 } from '../src/http';
import { fingerprint, topFrame } from '../src/observability';
import { seal, unseal } from '../src/settings/crypto';
import { defineSettings, fieldMeta, maskSecret } from '../src/settings';
import { formGuards, safeHtml } from '../src/validation';
import { tags, TAG_RE } from '../src/cache-tags';
import { z } from 'zod';

beforeAll(() => {
  process.env.INTERNAL_SECRET = 'x'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `2:${randomBytes(32).toString('base64')}`;
  process.env.SETTINGS_MASTER_KEY_PREVIOUS = `1:${randomBytes(32).toString('base64')}`;
});

describe('ids', () => {
  it('newId is a time-ordered UUIDv7', () => {
    const ids = Array.from({ length: 2000 }, newId);
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('slugify gives kebab-case that matches the slug regex', () => {
    expect(slugify('  Mango (Alphonso) & Jackfruit! ')).toBe('mango-alphonso-and-jackfruit');
    expect(slugify('Neem Café 2')).toBe('neem-cafe-2');
    expect(SLUG_RE.test(slugify('Ashwagandha Native Sapling'))).toBe(true);
    expect(SLUG_RE.test('Bad--slug')).toBe(false);
  });

  it('normalisePhone returns E.164 +91 or null', () => {
    for (const input of ['98765 43210', '+91 98765-43210', '919876543210', '09876543210', '(987) 654-3210']) {
      expect(normalisePhone(input)).toBe('+919876543210');
    }
    for (const bad of ['12345', '+1 415 555 0100', '5876543210', '98765432100']) expect(normalisePhone(bad)).toBeNull();
  });

  it('financial year runs April to March in IST', () => {
    expect(financialYear(new Date('2026-03-31T18:00:00Z'))).toBe('2025-26'); // 31 Mar 23:30 IST
    expect(financialYear(new Date('2026-03-31T18:31:00Z'))).toBe('2026-27'); // 1 Apr 00:01 IST
    expect(financialYear(new Date('2099-12-01T00:00:00Z'))).toBe('2099-00');
  });
});

describe('hmac + timing-safe compare', () => {
  const secret = 'webhook-secret';
  const raw = '{"event":"checkout.order.completed","amount":12300}';

  it('verifies hex, sha256= prefixed hex and base64 signatures', () => {
    const hex = signHmacSha256(raw, secret);
    expect(verifyHmacSha256(raw, hex, secret)).toBe(true);
    expect(verifyHmacSha256(raw, `sha256=${hex}`, secret)).toBe(true);
    expect(verifyHmacSha256(Buffer.from(raw), Buffer.from(hex, 'hex').toString('base64'), secret)).toBe(true);
  });

  it('rejects tampered bodies, wrong secrets and missing signatures', () => {
    const hex = signHmacSha256(raw, secret);
    expect(verifyHmacSha256(raw.replace('12300', '1'), hex, secret)).toBe(false);
    expect(verifyHmacSha256(raw, hex, 'other')).toBe(false);
    expect(verifyHmacSha256(raw, null, secret)).toBe(false);
    expect(verifyHmacSha256(raw, hex, '')).toBe(false);
  });

  it('timingSafeEqual handles unequal lengths', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('safeFetch SSRF guard', () => {
  it('classifies addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(ip)).toBe(true);
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip'])
      expect(isPublicAddress(ip), ip).toBe(false);
  });

  const refused = async (url: string, options = {}) => {
    await expect(safeFetch(url, {}, options)).rejects.toBeInstanceOf(SsrfError);
  };

  it('refuses http, credentials, odd ports and private literals', async () => {
    await refused('http://example.com/');
    await refused('https://user:pw@example.com/');
    await refused('https://example.com:8443/');
    await refused('https://127.0.0.1/');
    await refused('https://[::1]/');
    await refused('https://169.254.169.254/latest/meta-data/');
    await refused('https://10.0.0.5/');
  });

  it('refuses hosts outside the allowlist and names that resolve to private addresses', async () => {
    await refused('https://evil.example.org/', { allowHosts: ['api.phonepe.com', '*.facebook.com'] });
    await refused('https://localhost/');
    await expect(safeFetch('https://localhost/', {}, { allowHosts: ['localhost'] })).rejects.toThrow(/non-public/);
  });
});

describe('observability fingerprint', () => {
  const make = (message: string, line: number) => {
    const e = new TypeError(message);
    e.stack = `TypeError: ${message}\n    at getProduct (/srv/app/.next/server/chunks/ssr/3f9a1c2b7d._.js:${line}:17)\n    at render (/srv/app/node_modules/react/x.js:1:1)`;
    return e;
  };

  it('groups by name + normalised top frame + route, ignoring message, line numbers and build hashes', () => {
    expect(topFrame(make('a', 10).stack)).toBe('getProduct (/srv/app/.next/server/chunks/ssr/#._.js');
    expect(fingerprint(make('order 123 missing', 10), '/plant/[slug]')).toBe(fingerprint(make('order 456 missing', 99), '/plant/[slug]'));
    expect(fingerprint(make('x', 10), '/plant/[slug]')).not.toBe(fingerprint(make('x', 10), '/cart'));
    const other = make('x', 10);
    other.name = 'RangeError';
    expect(fingerprint(other, '/cart')).not.toBe(fingerprint(make('x', 10), '/cart'));
    expect(fingerprint('a string error')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('settings encryption', () => {
  it('round-trips and binds the ciphertext to module:key', () => {
    const sealed = seal('payments', 'clientSecret', 'sk_live_abcdef123456');
    expect(sealed.v).toBe(2);
    expect(JSON.stringify(sealed)).not.toContain('abcdef');
    expect(unseal('payments', 'clientSecret', sealed)).toBe('sk_live_abcdef123456');
    expect(() => unseal('payments', 'otherKey', sealed)).toThrow();
    expect(() => unseal('notifications', 'clientSecret', sealed)).toThrow();
  });

  it('detects tampering with ciphertext, tag or IV', () => {
    const sealed = seal('m', 'k', 'secret-value');
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, 'base64');
      buf[0] = buf[0]! ^ 1;
      return buf.toString('base64');
    };
    expect(() => unseal('m', 'k', { ...sealed, ct: flip(sealed.ct) })).toThrow();
    expect(() => unseal('m', 'k', { ...sealed, tag: flip(sealed.tag) })).toThrow();
    expect(() => unseal('m', 'k', { ...sealed, iv: flip(sealed.iv) })).toThrow();
  });

  it('decrypts values sealed with the previous key after rotation', () => {
    const current = process.env.SETTINGS_MASTER_KEY!;
    const previous = process.env.SETTINGS_MASTER_KEY_PREVIOUS!;
    process.env.SETTINGS_MASTER_KEY = previous;
    delete process.env.SETTINGS_MASTER_KEY_PREVIOUS;
    const old = seal('m', 'k', 'v1-value');
    process.env.SETTINGS_MASTER_KEY = current;
    process.env.SETTINGS_MASTER_KEY_PREVIOUS = previous;
    expect(old.v).toBe(1);
    expect(unseal('m', 'k', old)).toBe('v1-value');
  });

  it('finds secret fields through optional/default wrappers and masks to the last 4', () => {
    const def = defineSettings('payments', z.object({
      merchantId: z.string().meta({ group: 'PhonePe' }).optional(),
      clientSecret: z.string().meta({ secret: true, group: 'PhonePe' }).optional(),
      mode: z.enum(['online_only', 'partial_advance']).default('online_only'),
    }));
    expect(def.secretKeys).toEqual(['clientSecret']);
    expect(fieldMeta(def.schema.shape.merchantId)).toEqual({ group: 'PhonePe' });
    expect(maskSecret('sk_live_abcdef123456')).toBe('••••3456');
    expect(maskSecret('short')).toBe('••••');
    expect(maskSecret(null)).toBe('');
    expect(() => defineSettings('x', z.object({ n: z.number().meta({ secret: true }) }))).toThrow(/strings/);
  });
});

describe('form guards and safeHtml', () => {
  it('accepts a human-paced submission and rejects bots', () => {
    const t0 = 1_760_000_000_000;
    const token = formGuards.issue(t0);
    expect(formGuards.check({ _ft: token, website: '' }, { now: t0 + 5000 })).toEqual({ ok: true });
    expect(formGuards.check({ _ft: token, website: 'http://spam' }, { now: t0 + 5000 })).toEqual({ ok: false, reason: 'honeypot' });
    expect(formGuards.check({ _ft: token }, { now: t0 + 500 })).toEqual({ ok: false, reason: 'too_fast' });
    expect(formGuards.check({ _ft: token }, { now: t0 + 90_000_000 })).toEqual({ ok: false, reason: 'expired' });
    expect(formGuards.check({ _ft: `${t0 - 60_000}.${token.split('.')[1]}` }, { now: t0 + 5000 })).toEqual({ ok: false, reason: 'token' });
    const fd = new FormData();
    fd.set('_ft', token);
    expect(formGuards.check(fd, { now: t0 + 3000 })).toEqual({ ok: true });
  });

  it('keeps headings, tables and rel; strips scripts, handlers and javascript: links', () => {
    const out = safeHtml(
      '<h2>Care</h2><script>alert(1)</script><p onclick="x()">Water <a href="javascript:alert(1)">bad</a> <a href="https://a.example" rel="nofollow sponsored" target="_blank">ok</a></p><table><tr><td></td><td>1</td></tr></table><img src="x" onerror="y()">',
    );
    expect(out).toContain('<h2>Care</h2>');
    expect(out).not.toMatch(/script|onclick|onerror|javascript:/);
    expect(out).toContain('rel="nofollow sponsored noopener noreferrer"');
    expect(out).toContain('<td></td>');
  });
});

describe('env and cache tags', () => {
  it('requires production secrets and refuses mocks in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL[\s\S]*SITE_URL[\s\S]*INTERNAL_SECRET[\s\S]*SETTINGS_MASTER_KEY/);
    expect(() =>
      loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://a/b', SITE_URL: 'https://shop.example', INTERNAL_SECRET: 'y'.repeat(40), SETTINGS_MASTER_KEY: process.env.SETTINGS_MASTER_KEY, ENABLE_MOCKS: '1' }),
    ).toThrow(/ENABLE_MOCKS/);
    expect(loadEnv({}).NODE_ENV).toBe('development');
  });

  it('tag builders produce tags the revalidate endpoint accepts', () => {
    for (const t of [tags.catalog, tags.promoActive, tags.product(newId()), tags.settings('erp-sync'), tags.district('bengaluru-urban')]) expect(TAG_RE.test(t), t).toBe(true);
    expect(TAG_RE.test('product:../../x')).toBe(false);
  });
});
