import { randomBytes } from 'node:crypto';
import { listAudit } from '@ecomkit/core/audit';
import coreManifest, { createRegistry, defineModule } from '@ecomkit/core/manifest';
import { listErrorIssues } from '@ecomkit/core/observability';
import { coreSettings } from '@ecomkit/core/schema';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { eq } from 'drizzle-orm';
import type * as Navigation from 'next/navigation';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AuditPage, SettingsIndexPage, SettingsPage } from '../src/admin';
import type { FormState, StaffAdmin } from '../src/domain';
import { loadSettingsView, runSettingsAction, saveSettings, searchAdmin, staffForms } from '../src/server';
import { actAs, guest, installFakeAuth, isNotFound, render, staff } from './helpers';

// Settings renderer against real Postgres 17 (core_settings, core_audit_log, core_error_*), with a fixture module
// that declares a schema with a secret, actions of every kind, a custom panel and a copyable URL.

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-pathname': '/admin/settings/fixture-pay', 'x-real-ip': '203.0.113.9' }) }));
type NavigationModule = typeof Navigation;
vi.mock('next/navigation', async (original) => ({
  ...(await original<NavigationModule>()),
  usePathname: () => '/admin/settings/fixture-pay',
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

const SECRET = 'sk_live_TOPSECRET_9f3a2b7c4d1e';
const panelRuns: string[] = [];

const fixture = defineModule({
  id: 'fixture-pay',
  dependsOn: ['core'],
  admin: { nav: [{ label: 'Payments', href: '/admin/settings/fixture-pay', icon: 'credit-card', order: 910, permission: 'settings.read' }] },
  settings: {
    schema: z.object({
      merchantId: z.string().min(1).default('M-TEST').meta({ group: 'Account' }),
      mode: z.enum(['mock', 'sandbox', 'live']).default('mock').meta({ group: 'Account', help: 'Live takes real money.' }),
      advancePct: z.int().min(0).max(100).default(30).meta({ group: 'Cash on delivery' }),
      codEnabled: z.boolean().default(false).meta({ group: 'Cash on delivery' }),
      apiKey: z.string().optional().meta({ secret: true, group: 'Account' }),
    }),
    actions: [
      { id: 'test', label: 'Test connection', kind: 'test-connection', run: async () => async ({ moduleId }) => ({ ok: true, message: `Reached ${moduleId}` }) },
      { id: 'connect', label: 'Connect account', kind: 'oauth-redirect', run: async () => async () => ({ ok: true, message: 'Redirecting', redirectUrl: 'https://accounts.example.com/oauth?state=abc' }) },
      { id: 'connect-bad', label: 'Connect elsewhere', kind: 'oauth-redirect', run: async () => async () => ({ ok: true, message: 'Redirecting', redirectUrl: 'http://evil.example.com/' }) },
      {
        id: 'sync',
        label: 'Sync now',
        kind: 'server-action',
        run: async () => async () => {
          throw new Error('upstream refused');
        },
      },
      { id: 'rotate', label: 'Rotate keys', kind: 'server-action', permission: 'settings.secrets', run: async () => async () => ({ ok: true, message: 'Rotated' }) },
    ],
    customPanel: async () =>
      function ZonePanel({ moduleId }: { moduleId: string }) {
        panelRuns.push(moduleId);
        return <div data-panel="zones">{`Zone editor for ${moduleId}`}</div>;
      },
  },
  settingsUrls: [{ label: 'Webhook URL', path: '/api/webhooks/fixture-pay', help: 'Paste this in the provider dashboard.' }],
  adminSearch: [
    { id: 'orders', label: 'Orders', order: 1, permission: 'orders.read', search: async () => async (q: string) => [{ id: 'o1', title: `Order ${q}`, href: '/admin/orders/o1' }, { id: 'bad', title: 'Off-site', href: 'https://evil.example.com' }] },
    { id: 'customers', label: 'Customers', order: 2, permission: 'customers.export', search: async () => async () => [{ id: 'c1', title: 'Hidden', href: '/admin/customers/c1' }] },
    {
      id: 'broken',
      label: 'Broken',
      order: 3,
      permission: 'orders.read',
      search: async () => async () => {
        throw new Error('search index down');
      },
    },
  ],
});
const registry = createRegistry([coreManifest, fixture], { mocks: false });
const ID = 'fixture-pay';

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};
const pageProps = (moduleId: string) => ({
  registry,
  params: Promise.resolve({ module: moduleId }),
  save: async () => ({ ok: true, message: '' }),
  runAction: async () => ({ ok: true, message: '' }),
});
const noSecrets = (text: string) => !text.includes(SECRET) && !text.includes('TOPSECRET');

let t: TestDb;
beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'w'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  process.env.SITE_URL = 'https://shop.example.com';
  t = await createTestDb('wp-08-settings', { schemas: ['core'] });
  installFakeAuth();
});
afterAll(async () => {
  await t?.close();
});

describe('settings round trip', () => {
  it('owner saves fields and a secret; the secret is stored encrypted and never comes back', async () => {
    actAs(staff('owner'));
    const r = await saveSettings(registry, ID, form({ merchantId: 'M-42', mode: 'sandbox', advancePct: '40', codEnabled: 'on', apiKey: SECRET }));
    expect(r).toEqual({ ok: true, message: 'Settings saved.' });

    const [row] = await t.db.select().from(coreSettings).where(eq(coreSettings.key, 'apiKey'));
    expect(row!.isSecret).toBe(true);
    expect(noSecrets(JSON.stringify(row!.value))).toBe(true);

    const { Panel, ...view } = await loadSettingsView(registry, ID, staff('owner')).then((v) => v!);
    expect(Panel).toBeTypeOf('function');
    expect(noSecrets(JSON.stringify(view))).toBe(true);
    const byKey = Object.fromEntries(view.fields.map((f) => [f.key, f]));
    expect(byKey.apiKey).toMatchObject({ kind: 'secret', configured: true });
    expect(byKey.apiKey!.masked!.endsWith(SECRET.slice(-4))).toBe(true);
    expect(byKey.apiKey).not.toHaveProperty('value');
    expect(byKey.merchantId!.value).toBe('M-42');
    expect(byKey.codEnabled!.value).toBe(true);

    const { html } = await render(<SettingsPage {...pageProps(ID)} />);
    expect(noSecrets(html)).toBe(true);
    expect(html).toContain(SECRET.slice(-4));
  });

  it('an untouched secret field keeps the stored value', async () => {
    actAs(staff('owner'));
    expect((await saveSettings(registry, ID, form({ merchantId: 'M-43', apiKey: '' }))).ok).toBe(true);
    const view = (await loadSettingsView(registry, ID, staff('owner')))!;
    expect(view.fields.find((f) => f.key === 'apiKey')!.configured).toBe(true);
    expect(view.fields.find((f) => f.key === 'codEnabled')!.value).toBe(false);
  });

  it('a manager can save fields but not secrets; support cannot save at all', async () => {
    actAs(staff('manager'));
    const refused = await saveSettings(registry, ID, form({ merchantId: 'M-50', apiKey: 'sk_manager_attempt_000' }));
    expect(refused.ok).toBe(false);
    expect(refused.fieldErrors?.apiKey?.[0]).toMatch(/owner/);
    expect((await loadSettingsView(registry, ID, staff('manager')))!.fields.find((f) => f.key === 'merchantId')!.value).toBe('M-43');

    expect(await saveSettings(registry, ID, form({ merchantId: 'M-51' }))).toMatchObject({ ok: true });
    actAs(staff('support'));
    expect(await saveSettings(registry, ID, form({ merchantId: 'M-52' }))).toEqual({ ok: false, message: 'You do not have access to do this.' });
  });

  it('schema errors come back per field and nothing is written', async () => {
    actAs(staff('owner'));
    const r = await saveSettings(registry, ID, form({ merchantId: 'M-60', advancePct: '150', mode: 'bogus' }));
    expect(r.ok).toBe(false);
    expect(Object.keys(r.fieldErrors ?? {}).sort()).toEqual(['advancePct', 'mode']);
    const [row] = await t.db.select().from(coreSettings).where(eq(coreSettings.key, 'merchantId'));
    expect(row!.value).toBe('M-51');
  });

  it('every save is audited without the secret', async () => {
    const rows = await listAudit({ entity: 'settings', entityId: ID, limit: 20 });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(noSecrets(JSON.stringify(rows))).toBe(true);
    expect(rows.at(-1)!.after).toMatchObject({ secrets: { apiKey: 'replaced' } });
    expect(rows[0]!.ipHash).toBeTruthy();
    actAs(staff('owner'));
    const { html } = await render(<AuditPage searchParams={Promise.resolve({ entity: 'settings', entityId: ID })} />);
    expect(html).toContain('settings.update');
    expect(noSecrets(html)).toBe(true);
  });
});

describe('settings actions and custom panel', () => {
  it('render on the page with the copyable URL and the panel', async () => {
    actAs(staff('manager'));
    const { html } = await render(<SettingsPage {...pageProps(ID)} />);
    for (const label of ['Test connection', 'Connect account', 'Sync now', 'Rotate keys']) expect(html).toContain(label);
    expect(html).toContain('Zone editor for fixture-pay');
    expect(panelRuns).toContain(ID);
    expect(html).toContain('https://shop.example.com/api/webhooks/fixture-pay');
    expect(html).toContain('Payments');
  });

  it('run: result, audit trail and last status', async () => {
    actAs(staff('manager'));
    expect(await runSettingsAction(registry, ID, 'test')).toEqual({ ok: true, message: 'Reached fixture-pay' });
    const view = (await loadSettingsView(registry, ID, staff('manager')))!;
    expect(view.actions.find((a) => a.id === 'test')!.last).toMatchObject({ ok: true, message: 'Reached fixture-pay' });
    expect(view.actions.find((a) => a.id === 'rotate')!.allowed).toBe(false);
  });

  it('oauth-redirect returns a safe target only', async () => {
    actAs(staff('owner'));
    expect(await runSettingsAction(registry, ID, 'connect')).toEqual({ ok: true, message: 'Redirecting', redirectUrl: 'https://accounts.example.com/oauth?state=abc' });
    const bad = await runSettingsAction(registry, ID, 'connect-bad');
    expect(bad.ok).toBe(false);
    expect(bad).not.toHaveProperty('redirectUrl');
  });

  it('a throwing action fails cleanly and is captured; permissions and unknown ids are refused', async () => {
    actAs(staff('owner'));
    expect(await runSettingsAction(registry, ID, 'sync')).toEqual({ ok: false, message: 'Sync now failed. Details are under Health.' });
    expect((await listErrorIssues()).some((i) => i.title.includes('upstream refused'))).toBe(true);
    expect((await runSettingsAction(registry, ID, 'nope')).ok).toBe(false);
    actAs(staff('manager'));
    expect(await runSettingsAction(registry, ID, 'rotate')).toEqual({ ok: false, message: 'You do not have access to do this.' });
    actAs(staff('owner'));
    expect(await runSettingsAction(registry, ID, 'rotate')).toEqual({ ok: true, message: 'Rotated' });
  });

  it('guests 404, support gets no access, unknown modules 404, index lists the module by its nav label', async () => {
    const notFound = async (id: string) => (await render(<SettingsPage {...pageProps(id)} />)).errors.some(isNotFound);
    actAs(guest);
    expect(await notFound(ID)).toBe(true);
    actAs(staff('support'));
    expect((await render(<SettingsPage {...pageProps(ID)} />)).html).toContain('You do not have access');
    actAs(staff('owner'));
    expect(await notFound(ID)).toBe(false);
    expect(await notFound('not-a-module')).toBe(true);
    expect(await notFound('../etc')).toBe(true);
    const index = (await render(<SettingsIndexPage registry={registry} />)).html;
    expect(index).toContain('href="/admin/settings/fixture-pay"');
    expect(index).toContain('Account · Cash on delivery');
  });
});

describe('global search', () => {
  it('runs permitted providers, drops failing ones and off-site links', async () => {
    actAs(staff('manager'));
    const groups = await searchAdmin(registry, 'ORD-1001');
    expect(groups.map((g) => g.id)).toEqual(['orders', 'customers']);
    expect(groups[0]!.hits).toEqual([{ id: 'o1', title: 'Order ORD-1001', href: '/admin/orders/o1' }]);
    actAs(staff('fulfilment'));
    expect((await searchAdmin(registry, 'ORD-1001')).map((g) => g.id)).toEqual(['orders']);
    expect(await searchAdmin(registry, 'H')).toEqual([]);
    actAs(guest);
    expect(await searchAdmin(registry, 'ORD-1001')).toEqual([]);
  });
});

describe('staff forms', () => {
  const calls: unknown[][] = [];
  const fake: StaffAdmin = {
    listStaff: async () => [],
    inviteStaff: async (input) => void calls.push(['invite', input]),
    setStaffRole: async () => {
      throw new Error('the last owner cannot be demoted');
    },
    setStaffDisabled: async (id, disabled) => void calls.push(['disable', id, disabled]),
    resendInvite: async () => ({ link: 'x' }),
    getRoleMatrix: async () => ({ owner: [], manager: [], catalog_editor: [], fulfilment: [], support: [] }),
    setRolePermissions: async (role, perms) => void calls.push(['perms', role, perms]),
  };

  it('validate input, check staff.manage and surface business-rule errors', async () => {
    actAs(staff('owner'));
    const bad: FormState = await staffForms.invite(fake, form({ email: 'not-an-email', name: '', role: 'owner' }));
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(['email', 'name']);
    expect(await staffForms.invite(fake, form({ email: 'new@example.com', name: 'New Person', role: 'support' }))).toEqual({ ok: true, message: 'Invite sent to new@example.com.' });
    expect(calls).toContainEqual(['invite', { email: 'new@example.com', name: 'New Person', role: 'support' }]);
    expect(await staffForms.setRole(fake, form({ userId: 'u1', role: 'manager' }))).toEqual({ ok: false, message: 'The last owner cannot be demoted' });
    expect((await staffForms.setDisabled(fake, form({ userId: 'u2', disabled: 'true' }))).ok).toBe(true);
    expect(calls).toContainEqual(['disable', 'u2', true]);

    const one = form({ role: 'support' });
    one.append('permissions', 'orders.read');
    expect((await staffForms.setRolePermissions(fake, one)).ok).toBe(true);
    expect(calls).toContainEqual(['perms', 'support', ['orders.read']]);
    expect((await staffForms.setRolePermissions(fake, form({ role: 'fulfilment' }))).ok).toBe(true);
    expect(calls).toContainEqual(['perms', 'fulfilment', []]);
    const escalate = form({ role: 'manager' });
    escalate.append('permissions', 'staff.manage');
    expect((await staffForms.setRolePermissions(fake, escalate)).ok).toBe(false);
    expect((await staffForms.setRolePermissions(fake, form({ role: 'owner' }))).ok).toBe(false);

    actAs(staff('manager'));
    expect(await staffForms.resendInvite(fake, form({ userId: 'u1' }))).toEqual({ ok: false, message: 'You do not have access to do this.' });
  });
});
