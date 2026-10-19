import { defineModule } from '@ecomkit/core/manifest';

/**
 * UI primitives have no tables, settings or jobs. The only route is the component stories page,
 * served in development and test builds only (the page 404s in production unless ENABLE_MOCKS=1).
 */
export default defineModule({
  id: 'ui',
  dependsOn: ['core'],
  admin: {
    pages: [{ path: '/admin/dev/ui', module: 'routes/dev-ui', kind: 'page', exports: ['default', 'generateMetadata'] }],
  },
});
