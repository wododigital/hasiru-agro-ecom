import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';

const page = (path: string, module: string) => ({ path, module, kind: 'page' as const, exports: ['default', 'generateMetadata'] as const });

/** Profiles, addresses, the one consent store, leads, land profiles and four computed segments. */
export default defineModule({
  id: 'customers',
  dependsOn: ['core', 'auth'],
  schema: () => import('./schema'),
  routes: [
    page('/account/profile', 'routes/account-profile'),
    page('/account/addresses', 'routes/account-addresses'),
    page('/account/land', 'routes/account-land'),
  ],
  admin: {
    nav: [
      { label: 'Customers', href: '/admin/customers', icon: 'users', order: NAV_BANDS.customers, permission: 'customers.read' },
      { label: 'Leads', href: '/admin/leads', icon: 'user-plus', order: NAV_BANDS.customers + 10, permission: 'customers.read' },
      { label: 'Segments', href: '/admin/segments', icon: 'pie-chart', order: NAV_BANDS.customers + 20, permission: 'customers.read' },
      { label: 'Consent', href: '/admin/consent', icon: 'shield-check', order: NAV_BANDS.customers + 30, permission: 'customers.read' },
    ],
    pages: [
      page('/admin/customers', 'routes/admin-customers'),
      page('/admin/customers/[id]', 'routes/admin-customer'),
      page('/admin/leads', 'routes/admin-leads'),
      page('/admin/segments', 'routes/admin-segments'),
      page('/admin/consent', 'routes/admin-consent'),
    ],
  },
  permissions: ['customers.read', 'customers.write', 'customers.export'],
  emits: ['customer.created', 'lead.created', 'consent.changed'],
});
