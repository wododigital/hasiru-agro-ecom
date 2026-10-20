import { NAV_BANDS, ROLE_PERMISSIONS, type AdminNavItem } from '@ecomkit/core/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  absoluteUrl,
  activeHref,
  activeSection,
  compareRange,
  parseCompare,
  adminGate,
  auditChanges,
  bandOf,
  describeSettings,
  formToPatch,
  groupFields,
  humanize,
  navSections,
  parseRange,
  safeRedirect,
  searchProviders,
  settingsUrls,
} from '../src/domain';

describe('adminGate', () => {
  const staffViewer = { kind: 'staff', userId: 'u', name: 'S', email: 's@example.com', role: 'support', permissions: [] } as const;
  it('shows the shell to staff on any path', () => {
    expect(adminGate(staffViewer, '/admin')).toBe('shell');
    expect(adminGate(staffViewer, null)).toBe('shell');
  });
  it('404s guests and customers outside the sign-in page', () => {
    expect(adminGate({ kind: 'guest' }, '/admin')).toBe('not-found');
    expect(adminGate({ kind: 'guest' }, '/admin/settings/payments')).toBe('not-found');
    expect(adminGate({ kind: 'customer', userId: 'c', customerId: 'c', name: null, phone: null, email: null }, '/admin/orders')).toBe('not-found');
    expect(adminGate({ kind: 'guest' }, '/admin/loginx')).toBe('not-found');
  });
  it('renders the sign-in page bare and leaves unknown paths to the page guard', () => {
    expect(adminGate({ kind: 'guest' }, '/admin/login')).toBe('bare');
    expect(adminGate({ kind: 'guest' }, '/admin/login/')).toBe('bare');
    expect(adminGate({ kind: 'guest' }, null)).toBe('bare');
  });
});

describe('navSections', () => {
  const nav: AdminNavItem[] = [
    { label: 'Home', href: '/admin', icon: 'house', order: NAV_BANDS.home },
    { label: 'Orders', href: '/admin/orders', icon: 'package', order: 100, permission: 'orders.read' },
    { label: 'Dispatch', href: '/admin/dispatch', icon: 'truck', order: 110, permission: 'orders.dispatch' },
    { label: 'Products', href: '/admin/products', icon: 'sprout', order: 200, permission: 'products.read' },
    { label: 'Settings', href: '/admin/settings', icon: 'settings', order: 900, permission: 'settings.read' },
    { label: 'Audit log', href: '/admin/audit', icon: 'scroll-text', order: 990, permission: 'audit.read' },
  ];
  it('groups by band and keeps registry order', () => {
    const s = navSections(nav, ROLE_PERMISSIONS.owner);
    expect(s.map((x) => x.label)).toEqual(['Home', 'Orders', 'Products', 'Settings']);
    expect(s[1]!.items.map((i) => i.label)).toEqual(['Orders', 'Dispatch']);
  });
  it('drops what the role may not open, and empty bands with it', () => {
    const s = navSections(nav, ROLE_PERMISSIONS.catalog_editor);
    expect(s.flatMap((x) => x.items.map((i) => i.href))).toEqual(['/admin', '/admin/products']);
    const support = navSections(nav, ROLE_PERMISSIONS.support).flatMap((x) => x.items.map((i) => i.href));
    expect(support).toEqual(['/admin', '/admin/orders', '/admin/products']);
  });
  it('bandOf maps order values into bands', () => {
    expect(bandOf(0)).toBe('home');
    expect(bandOf(199)).toBe('orders');
    expect(bandOf(985)).toBe('settings');
  });
  it('activeHref picks the longest matching href and never lights Home for sub pages', () => {
    const hrefs = ['/admin', '/admin/orders', '/admin/orders/dispatch'];
    expect(activeHref(hrefs, '/admin')).toBe('/admin');
    expect(activeHref(hrefs, '/admin/orders/123')).toBe('/admin/orders');
    expect(activeHref(hrefs, '/admin/orders/dispatch')).toBe('/admin/orders/dispatch');
    expect(activeHref(hrefs, '/admin/unknown')).toBeNull();
  });
});

const schema = z.object({
  storeName: z.string().min(1).meta({ group: 'Store', title: 'Store name' }),
  supportEmail: z.email().optional().meta({ group: 'Store' }),
  callbackUrl: z.url().optional(),
  mode: z.enum(['mock', 'sandbox', 'live']).default('mock').meta({ group: 'Payments', help: 'Live takes real money.' }),
  advancePct: z.int().min(0).max(100).default(30).meta({ group: 'Payments' }),
  codEnabled: z.boolean().default(false).meta({ group: 'Payments' }),
  apiKey: z.string().optional().meta({ secret: true, group: 'Payments' }),
  districts: z.array(z.string()).default([]),
  channels: z.array(z.enum(['whatsapp', 'email'])).default(['email']),
  zones: z.array(z.object({ name: z.string() })).default([]),
});

describe('describeSettings', () => {
  const fields = describeSettings(schema);
  const by = Object.fromEntries(fields.map((f) => [f.key, f]));
  it('maps zod types to field kinds', () => {
    expect(Object.fromEntries(fields.map((f) => [f.key, f.kind]))).toEqual({
      storeName: 'text',
      supportEmail: 'email',
      callbackUrl: 'url',
      mode: 'select',
      advancePct: 'number',
      codEnabled: 'boolean',
      apiKey: 'secret',
      districts: 'lines',
      channels: 'multiselect',
      zones: 'readonly',
    });
  });
  it('reads labels, groups, help, required and defaults', () => {
    expect(by.storeName).toMatchObject({ label: 'Store name', group: 'Store', required: true });
    expect(by.supportEmail).toMatchObject({ label: 'Support email', group: 'Store', required: false });
    expect(by.mode).toMatchObject({ options: ['mock', 'sandbox', 'live'], help: 'Live takes real money.', defaultValue: 'mock', required: false });
    expect(by.advancePct).toMatchObject({ integer: true, defaultValue: 30 });
    expect(by.callbackUrl!.group).toBe('General');
    expect(groupFields(fields).map((g) => g.group)).toEqual(['Store', 'General', 'Payments']);
  });
  it('humanize', () => {
    expect(humanize('gstinNumber')).toBe('Gstin number');
    expect(humanize('dev_whatsapp-number')).toBe('Dev whatsapp number');
  });
});

describe('formToPatch', () => {
  const fields = describeSettings(schema);
  const form = (entries: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };
  it('coerces every kind and treats an absent checkbox as false', () => {
    const { patch, fieldErrors } = formToPatch(
      fields,
      form([
        ['storeName', ' Green Shop '],
        ['supportEmail', ''],
        ['mode', 'live'],
        ['advancePct', '40'],
        ['districts', 'Mysuru\n\n Hassan \r\n'],
        ['channels', 'whatsapp'],
        ['channels', 'email'],
        ['apiKey', 'sk_live_123456789'],
      ]),
      { canWriteSecrets: true },
    );
    expect(fieldErrors).toEqual({});
    expect(patch).toEqual({ storeName: 'Green Shop', mode: 'live', advancePct: 40, codEnabled: false, districts: ['Mysuru', 'Hassan'], channels: ['whatsapp', 'email'], apiKey: 'sk_live_123456789' });
  });
  it('an empty secret keeps the stored value; a secret from a non-owner is refused', () => {
    expect(formToPatch(fields, form([['storeName', 'x'], ['apiKey', '']]), { canWriteSecrets: true }).patch).not.toHaveProperty('apiKey');
    const r = formToPatch(fields, form([['storeName', 'x'], ['apiKey', 'sk_new']]), { canWriteSecrets: false });
    expect(r.patch).not.toHaveProperty('apiKey');
    expect(r.fieldErrors.apiKey).toHaveLength(1);
  });
  it('passes bad numbers through so the schema reports them, and never writes readonly fields', () => {
    const r = formToPatch(fields, form([['advancePct', 'abc'], ['zones', '[]']]), { canWriteSecrets: true });
    expect(r.patch.advancePct).toBe('abc');
    expect(r.patch).not.toHaveProperty('zones');
  });
});

describe('safeRedirect', () => {
  it('allows https and same-origin paths only', () => {
    expect(safeRedirect('https://accounts.example.com/o/oauth2?x=1')).toBe('https://accounts.example.com/o/oauth2?x=1');
    expect(safeRedirect('/admin/settings/notifications')).toBe('/admin/settings/notifications');
    expect(safeRedirect('http://example.com')).toBeNull();
    expect(safeRedirect('//evil.example.com')).toBeNull();
    expect(safeRedirect('/\\evil.example.com')).toBeNull();
    expect(safeRedirect('javascript:alert(1)')).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
  });
});

describe('parseRange', () => {
  const now = new Date('2026-10-20T20:00:00Z'); // 21 Oct 01:30 IST
  it('defaults to the last 30 days ending today in IST', () => {
    expect(parseRange({}, now)).toEqual({ from: '2026-09-22', to: '2026-10-21' });
  });
  it('accepts a valid range and rejects reversed, malformed or over-long ones', () => {
    expect(parseRange({ from: '2026-10-01', to: '2026-10-10' }, now)).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(parseRange({ from: '2026-10-10', to: '2026-10-01' }, now).to).toBe('2026-10-21');
    expect(parseRange({ from: '2026-13-01', to: '2026-10-01' }, now).to).toBe('2026-10-21');
    expect(parseRange({ from: '2024-01-01', to: '2026-10-01' }, now).to).toBe('2026-10-21');
  });
});

describe('auditChanges', () => {
  it('lists changed keys only, sorted', () => {
    expect(auditChanges({ a: 1, b: 2, c: [1] }, { a: 1, b: 3, c: [1, 2], d: 'x' })).toEqual([
      { key: 'b', before: 2, after: 3 },
      { key: 'c', before: [1], after: [1, 2] },
      { key: 'd', before: null, after: 'x' },
    ]);
  });
  it('treats scalars and arrays as one value', () => {
    expect(auditChanges(['a'], ['b'])).toEqual([{ key: 'value', before: ['a'], after: ['b'] }]);
    expect(auditChanges(null, null)).toEqual([]);
    expect(auditChanges(null, { ok: true })).toEqual([{ key: 'ok', before: null, after: true }]);
  });
});

describe('manifest extensions', () => {
  const search = async () => async () => [];
  it('reads valid search providers, drops malformed ones, sorts by order', () => {
    const modules = [
      { id: 'b', dependsOn: [], adminSearch: [{ id: 'orders', label: 'Orders', order: 1, permission: 'orders.read', search }] },
      { id: 'a', dependsOn: [], adminSearch: [{ id: 'bad', label: 'Bad', order: 0, permission: 'not.a.permission', search }, { id: 'nofn', label: 'X', order: 0, permission: 'orders.read' }] },
      { id: 'c', dependsOn: [], adminSearch: [{ id: 'customers', label: 'Customers', order: 0, permission: 'customers.read', search }] },
    ];
    expect(searchProviders(modules).map((p) => `${p.moduleId}:${p.id}`)).toEqual(['c:customers', 'b:orders']);
  });
  it('reads copyable settings URLs and makes them absolute', () => {
    const m = { id: 'x', dependsOn: [], settingsUrls: [{ label: 'Webhook', path: '/api/webhooks/x' }, { label: 'Bad', path: 'javascript:1' }] };
    expect(settingsUrls(m)).toEqual([{ label: 'Webhook', path: '/api/webhooks/x' }]);
    expect(absoluteUrl('/api/webhooks/x', 'https://shop.example.com')).toBe('https://shop.example.com/api/webhooks/x');
    expect(absoluteUrl('/api/webhooks/x', null)).toBe('/api/webhooks/x');
    expect(settingsUrls(undefined)).toEqual([]);
  });
});

describe('compareRange', () => {
  it('previous period is the same length immediately before', () => {
    expect(compareRange({ from: '2026-10-01', to: '2026-10-14' }, 'previous-period')).toEqual({ from: '2026-09-17', to: '2026-09-30' });
  });
  it('previous year shifts 365 days and none is null', () => {
    expect(compareRange({ from: '2026-10-01', to: '2026-10-14' }, 'previous-year')).toEqual({ from: '2025-10-01', to: '2025-10-14' });
    expect(compareRange({ from: '2026-10-01', to: '2026-10-14' }, 'none')).toBeNull();
    expect(parseCompare('junk')).toBe('previous-period');
  });
});

describe('navSections ordering (Shopify)', () => {
  it('folds enquiries into customers and pins settings last', () => {
    const s = navSections(
      [
        { label: 'Home', href: '/admin', icon: 'house', order: 0 },
        { label: 'Customers', href: '/admin/customers', icon: 'users', order: 300 },
        { label: 'Discounts', href: '/admin/discounts', icon: 'percent', order: 410 },
        { label: 'Pages', href: '/admin/content', icon: 'file', order: 500 },
        { label: 'Enquiries', href: '/admin/enquiries', icon: 'inbox', order: 700 },
        { label: 'Settings', href: '/admin/settings', icon: 'settings', order: 900 },
      ],
      ROLE_PERMISSIONS.owner,
    );
    expect(s.map((x) => x.band)).toEqual(['home', 'customers', 'content', 'marketing', 'settings']);
    expect(s[1]!.items.map((i) => i.label)).toEqual(['Customers', 'Enquiries']);
    expect(activeSection(s, '/admin/enquiries/12')).toBe('customers');
  });
});
