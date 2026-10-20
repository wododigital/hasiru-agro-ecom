import { defineModule } from '@ecomkit/core/manifest';
import { opsSettingsSchema } from './domain';

/**
 * ERP adapter for the operations app (hasiru-ops): transports `mock`, `pg` (read-only ecom_sync role, stock in) and
 * `ops-api` (signed HTTPS, the endpoints the operations team adds later); orders out over ops-api; leads to the
 * existing lead intake. Plugs into erp-sync through `configureErpSync({ adapter: opsAdapter })`.
 * hasiru-ops itself is never modified (docs/hasiru-ops-sync-spec.md).
 */
export default defineModule({
  id: 'hasiru-ops-adapter',
  dependsOn: ['core', 'erp-sync'],
  routes: [{ path: '/api/webhooks/ops', module: 'routes/ops-webhook', kind: 'route', exports: ['POST'] }],
  mockRoutes: [{ path: '/api/_mock/hasiru-ops/[...path]', module: 'mocks/hasiru-ops', kind: 'route', exports: ['GET', 'POST'] }],
  settings: {
    schema: opsSettingsSchema,
    actions: [{ id: 'test-connection', label: 'Test connection', kind: 'test-connection', run: () => import('./server').then((m) => m.testConnectionAction) }],
  },
  permissions: ['settings.read', 'settings.write', 'settings.secrets'],
});
