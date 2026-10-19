import { defineModule } from '@ecomkit/core/manifest';

/**
 * Customer sign-in by one-time code (phone via WhatsApp, or email), staff sign-in with password + authenticator,
 * the role matrix and the `auth` service every permission check goes through.
 */
export default defineModule({
  id: 'auth',
  dependsOn: ['core', 'ui'],
  optional: ['notifications'],
  schema: () => import('./schema'),
  routes: [
    { path: '/api/auth/[...all]', module: 'routes/auth-handler', kind: 'route', exports: ['GET', 'POST'] },
    { path: '/account', module: 'routes/account', kind: 'page', exports: ['default', 'generateMetadata'] },
    { path: '/account/login', module: 'routes/account-login', kind: 'page', exports: ['default', 'generateMetadata'] },
  ],
  admin: {
    pages: [{ path: '/admin/login', module: 'routes/admin-login', kind: 'page', exports: ['default', 'generateMetadata'] }],
  },
  permissions: ['staff.manage'],
  provides: { auth: () => import('./server/viewer').then((m) => m.authContext) },
  emits: ['customer.created'],
  seedHooks: [{ id: 'auth.role-permissions', order: 0, run: () => import('./server/seed').then((m) => m.seedRolePermissions) }],
});
