import { existsSync } from 'node:fs';
import coreManifest from '@ecomkit/core/manifest';
import { resolveModules } from '@ecomkit/core/manifest';
import uiManifest from '@ecomkit/ui/manifest';
import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  effectivePermissions,
  isPlaceholderEmail,
  isStaffRole,
  parseIdentifier,
  placeholderEmail,
  safeNextPath,
} from '../src/domain';
import manifest from '../src/manifest';
import { authMessages } from '../src/messages';

describe('identifiers', () => {
  it('normalises Indian mobiles to E.164 and emails to lowercase', () => {
    expect(parseIdentifier('98765 43210')).toEqual({ kind: 'phone', value: '+919876543210' });
    expect(parseIdentifier('+91-98765-43210')).toEqual({ kind: 'phone', value: '+919876543210' });
    expect(parseIdentifier(' Me@Example.COM ')).toEqual({ kind: 'email', value: 'me@example.com' });
    for (const bad of ['12345', '+14155550100', 'me@', '', 42, null]) expect(parseIdentifier(bad)).toBeNull();
  });

  it('phone-only accounts get a reserved placeholder email that is never shown', () => {
    expect(placeholderEmail('+919876543210')).toBe('919876543210@phone.invalid');
    expect(isPlaceholderEmail('919876543210@phone.invalid')).toBe(true);
    expect(isPlaceholderEmail('me@example.com')).toBe(false);
  });
});

describe('roles', () => {
  it('owner always has every permission; other roles only what is stored and known', () => {
    expect(effectivePermissions('owner', [])).toEqual([...PERMISSIONS]);
    expect(effectivePermissions('support', ['orders.read', 'not.real'])).toEqual(['orders.read']);
    expect(isStaffRole('manager')).toBe(true);
    expect(isStaffRole('customer')).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });
});

describe('redirects after sign-in', () => {
  it('only follows same-site paths', () => {
    expect(safeNextPath('/account/orders', '/account')).toBe('/account/orders');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', undefined, ['/a']]) expect(safeNextPath(bad, '/account')).toBe('/account');
    for (const bad of ['/\t/evil.example', '/\n/evil.example', '/a\\b', '/%0a', '/\u0000x']) expect(safeNextPath(bad, '/account'), JSON.stringify(bad)).toBe(bad === '/%0a' ? '/%0a' : '/account');
    expect(safeNextPath('/plants?c=fruit#top', '/account')).toBe('/plants?c=fruit#top');
  });
});

describe('manifest', () => {
  it('resolves with core and ui, and every route module exists', () => {
    expect(resolveModules([coreManifest, uiManifest, manifest], ['core', 'ui', 'auth']).map((m) => m.id)).toEqual(['core', 'ui', 'auth']);
    for (const r of [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])]) {
      expect(existsSync(new URL(`../src/${r.module}.tsx`, import.meta.url)), r.module).toBe(true);
    }
  });

  it('route modules export what the manifest declares', async () => {
    for (const r of [...(manifest.routes ?? []), ...(manifest.admin?.pages ?? [])]) {
      const mod = (await import(/* @vite-ignore */ new URL(`../src/${r.module}.tsx`, import.meta.url).href)) as Record<string, unknown>;
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
  });

  it('provides the auth service', async () => {
    const auth = await manifest.provides.auth();
    expect(Object.keys(auth).sort()).toEqual(['getViewer', 'requireOwner', 'requirePermission']);
  });
});

describe('copy', () => {
  it('has no em dashes and no release-stage words', () => {
    const text = JSON.stringify(authMessages, (_k, v: unknown) => (typeof v === 'function' ? v.toString() : v));
    expect(text).not.toMatch(/\u2014/);
    expect(text).not.toMatch(/\b(phase|v1|v2)\b/i);
  });
});
