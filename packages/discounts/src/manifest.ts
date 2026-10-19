import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';

const release = () => import('./server/events').then((m) => m.releaseOnOrderEnd);

/** Automatic promotions, coupon codes, eligibility, usage limits and atomic redemptions (A8 stacking). */
export default defineModule({
  id: 'discounts',
  dependsOn: ['core', 'catalog'],
  schema: () => import('./schema'),
  permissions: ['marketing.write'],
  admin: {
    nav: [{ label: 'Discounts', href: '/admin/discounts', icon: 'percent', order: NAV_BANDS.marketing + 10, permission: 'marketing.write' }],
    pages: [
      { path: '/admin/discounts', module: 'routes/admin-discounts', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/discounts/new', module: 'routes/admin-discount-new', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/discounts/[id]', module: 'routes/admin-discount-edit', kind: 'page', exports: ['default', 'generateMetadata'] },
    ],
  },
  on: { 'order.cancelled': release, 'order.payment_failed': release },
});
