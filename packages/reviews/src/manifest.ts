import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';

/** Product reviews with photos, verified-buyer flag, moderation and a per-product aggregate. No Q&A. */
export default defineModule({
  id: 'reviews',
  dependsOn: ['core', 'catalog', 'media'],
  optional: ['orders'],
  schema: () => import('./schema'),
  routes: [
    { path: '/account/reviews', module: 'routes/account-reviews', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/api/reviews', module: 'routes/review-api', kind: 'route', exports: ['POST'] },
  ],
  admin: {
    nav: [{ label: 'Reviews', href: '/admin/reviews', icon: 'star', order: NAV_BANDS.products + 70, permission: 'reviews.moderate' }],
    pages: [{ path: '/admin/reviews', module: 'routes/admin-reviews', kind: 'page', exports: ['default', 'generateMetadata'] }],
  },
  // Home "Things to do" (read structurally by admin-shell).
  adminTodos: [{ id: 'reviews.pending', label: 'reviews to moderate', href: '/admin/reviews?status=pending', order: 70, permission: 'reviews.moderate', count: () => import('./admin/todos').then((m) => m.pendingReviews) }],
  permissions: ['reviews.moderate'],
  emits: ['review.submitted', 'review.approved'],
  provides: { reviews: () => import('./server/reviews').then((m) => m.reviewsReader) },
  pdpSections: [{ id: 'reviews', order: 80, slot: 'below', component: () => import('./ui/ReviewsSection').then((m) => m.ReviewsSection) }],
});
