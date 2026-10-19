import { NAV_BANDS } from '@ecomkit/core/contracts';
import coreManifest, { createRegistry, defineModule } from '@ecomkit/core/manifest';
import type * as Navigation from 'next/navigation';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesPage, StaffPage, type StaffActions } from '../src/admin';
import { AdminLayout } from '../src/admin/AdminLayout';
import { DashboardPage } from '../src/dashboard/DashboardFrame';
import type { FormState, StaffAdmin } from '../src/domain';
import shellManifest from '../src/manifest';
import { actAs, customer, guest, installFakeAuth, isNotFound, render, staff } from './helpers';

// Role-gated rendering of the shell, dashboard and staff screens. No database: the viewer comes from a fake auth service.

let path = '/admin';
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-pathname': path }) }));
type NavigationModule = typeof Navigation;
vi.mock('next/navigation', async (original) => ({
  ...(await original<NavigationModule>()),
  usePathname: () => path,
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));

const ui = defineModule({ id: 'ui', dependsOn: ['core'] });
const auth = defineModule({ id: 'auth', dependsOn: ['core', 'ui'] });
const orders = defineModule({
  id: 'orders',
  dependsOn: ['core'],
  admin: { nav: [{ label: 'Orders', href: '/admin/orders', icon: 'package', order: NAV_BANDS.orders, permission: 'orders.read' }] },
  dashboardWidgets: [
    { id: 'sales', title: 'Net sales', order: 1, size: 'md', permission: 'analytics.read', component: async () => ({ range }) => <p>{`sales ${range.from}..${range.to}`}</p> },
    { id: 'to-confirm', title: 'Orders to confirm', order: 2, size: 'sm', permission: 'orders.read', component: async () => () => <p>3 orders waiting</p> },
    {
      id: 'broken',
      title: 'Broken tile',
      order: 3,
      size: 'sm',
      component: async () => () => {
        throw new Error('tile exploded');
      },
    },
  ],
});
const registry = createRegistry([coreManifest, ui, auth, shellManifest, orders], { mocks: false });
const page = <p data-testid="page">PAGE BODY</p>;

beforeAll(() => installFakeAuth());
beforeEach(() => {
  path = '/admin';
});

describe('AdminLayout gate', () => {
  it('404s a guest and a customer on admin pages without rendering the page', async () => {
    for (const viewer of [guest, customer]) {
      actAs(viewer);
      const { html, errors } = await render(<AdminLayout registry={registry}>{page}</AdminLayout>);
      expect(errors.some(isNotFound)).toBe(true);
      expect(html).not.toContain('PAGE BODY');
    }
  });

  it('renders the sign-in page bare for a guest', async () => {
    actAs(guest);
    path = '/admin/login';
    const { html, errors } = await render(<AdminLayout registry={registry}>{page}</AdminLayout>);
    expect(errors).toEqual([]);
    expect(html).toContain('PAGE BODY');
    expect(html).not.toContain('aria-label="Admin"');
  });

  it('owner sees every nav item; support sees only what the role may open', async () => {
    actAs(staff('owner'));
    const owner = (await render(<AdminLayout registry={registry} title="Test store">{page}</AdminLayout>)).html;
    for (const href of ['/admin', '/admin/orders', '/admin/settings', '/admin/staff', '/admin/roles', '/admin/audit']) expect(owner).toContain(`href="${href}"`);
    expect(owner).toContain('PAGE BODY');
    expect(owner).toContain('Test store');

    actAs(staff('support'));
    const support = (await render(<AdminLayout registry={registry}>{page}</AdminLayout>)).html;
    expect(support).toContain('href="/admin/orders"');
    for (const href of ['/admin/settings', '/admin/staff', '/admin/roles', '/admin/audit']) expect(support).not.toContain(`href="${href}"`);
    expect(support).toContain('PAGE BODY');
  });

  it('marks the current page in the nav', async () => {
    actAs(staff('owner'));
    path = '/admin/orders/abc';
    const { html } = await render(<AdminLayout registry={registry}>{page}</AdminLayout>);
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/orders"|href="\/admin\/orders"[^>]*aria-current="page"/);
  });

  it('shows the search box only when a module offers search the viewer may use', async () => {
    const search = async () => [];
    actAs(staff('owner'));
    expect((await render(<AdminLayout registry={registry} search={search}>{page}</AdminLayout>)).html).not.toContain('Search the admin');
    const withSearch = createRegistry(
      [coreManifest, ui, auth, shellManifest, defineModule({ id: 'orders', dependsOn: ['core'], adminSearch: [{ id: 'orders', label: 'Orders', order: 0, permission: 'orders.read', search: async () => async () => [] }] })],
      { mocks: false },
    );
    expect((await render(<AdminLayout registry={withSearch} search={search}>{page}</AdminLayout>)).html).toContain('Search the admin');
    actAs(staff('catalog_editor'));
    expect((await render(<AdminLayout registry={withSearch} search={search}>{page}</AdminLayout>)).html).not.toContain('Search the admin');
  });
});

describe('DashboardPage', () => {
  const now = new Date('2026-10-20T10:00:00+05:30');
  it('404s non-staff', async () => {
    actAs(guest);
    const { html, errors } = await render(<DashboardPage registry={registry} searchParams={Promise.resolve({})} now={now} />);
    expect(errors.some(isNotFound)).toBe(true);
    expect(html).not.toContain('Hello');
  });

  it('renders permitted widgets with the range, isolates a failing one', async () => {
    actAs(staff('owner'));
    const { html, errors } = await render(<DashboardPage registry={registry} searchParams={Promise.resolve({ from: '2026-10-01', to: '2026-10-07' })} now={now} />);
    expect(html).toContain('sales 2026-10-01..2026-10-07');
    expect(html).toContain('3 orders waiting');
    expect(html).toContain('Broken tile');
    expect(errors.map(String).join()).toContain('tile exploded');
  });

  it('hides widgets the role may not see', async () => {
    actAs(staff('fulfilment'));
    const { html } = await render(<DashboardPage registry={registry} searchParams={Promise.resolve({})} now={now} />);
    expect(html).not.toContain('Net sales');
    expect(html).toContain('3 orders waiting');
    expect(html).toContain('2026-09-21');
  });
});

describe('Staff and roles screens', () => {
  const members = [
    { id: 'a', name: 'Asha Owner', email: 'asha@example.com', role: 'owner', twoFactorEnabled: true, disabled: false, invitePending: false, createdAt: new Date('2026-01-01') },
    { id: 'b', name: 'Ravi Packer', email: 'ravi@example.com', role: 'fulfilment', twoFactorEnabled: false, disabled: false, invitePending: true, createdAt: new Date('2026-02-01') },
    { id: 'c', name: 'Meena Help', email: 'meena@example.com', role: 'support', twoFactorEnabled: true, disabled: true, invitePending: false, createdAt: new Date('2026-03-01') },
  ] as const;
  const fake: StaffAdmin = {
    listStaff: async () => members.map((m) => ({ ...m })),
    inviteStaff: async () => ({}),
    setStaffRole: async () => {},
    setStaffDisabled: async () => {},
    resendInvite: async () => {},
    getRoleMatrix: async () => ({ owner: [], manager: ['orders.read'], catalog_editor: ['products.write'], fulfilment: [], support: [] }),
    setRolePermissions: async () => {},
  };
  const noop = async (): Promise<FormState> => ({ ok: true, message: '' });
  const actions: StaffActions = { invite: noop, setRole: noop, setDisabled: noop, resendInvite: noop };

  it('managers get the no-access notice, never the list', async () => {
    actAs(staff('manager'));
    const { html } = await render(<StaffPage staff={fake} actions={actions} searchParams={Promise.resolve({})} />);
    expect(html).toContain('You do not have access');
    expect(html).not.toContain('ravi@example.com');
  });

  it('owner sees the list, filtered and sorted from the URL', async () => {
    actAs({ ...staff('owner'), userId: 'a' });
    const all = (await render(<StaffPage staff={fake} actions={actions} searchParams={Promise.resolve({})} />)).html;
    expect(all.indexOf('Asha Owner')).toBeLessThan(all.indexOf('Meena Help'));
    expect(all).toContain('This is you');
    expect(all).toContain('Resend invite');
    const filtered = (await render(<StaffPage staff={fake} actions={actions} searchParams={Promise.resolve({ status: 'disabled', q: 'meena' })} />)).html;
    expect(filtered).toContain('meena@example.com');
    expect(filtered).not.toContain('ravi@example.com');
    const sorted = (await render(<StaffPage staff={fake} actions={actions} searchParams={Promise.resolve({ sort: 'name', dir: 'desc' })} />)).html;
    expect(sorted.indexOf('Ravi Packer')).toBeLessThan(sorted.indexOf('Asha Owner'));
  });

  it('roles matrix ticks current permissions and locks owner-only ones', async () => {
    actAs(staff('owner'));
    const { html } = await render(<RolesPage staff={fake} save={noop} />);
    expect(html).toContain('Every permission, including secrets and staff');
    expect(html.includes('checked="" value="orders.read"')).toBe(true);
    expect(html.includes('disabled="" name="permissions" value="staff.manage"')).toBe(true);
  });
});
