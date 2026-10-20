import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { assistantSettingsSchema } from './settings';

export default defineModule({
  id: 'ai-assistant',
  dependsOn: ['core', 'catalog'],
  // Read through the registry when enabled: prices, stock, district fit. Companions come through configureAssistant.
  optional: ['pricing', 'inventory', 'places', 'planting', 'cart'],
  schema: () => import('./schema'),
  routes: [{ path: '/api/assistant/stream', module: 'routes/assistant-stream', kind: 'route', exports: ['POST'] }],
  mockRoutes: [{ path: '/api/_mock/claude/[...path]', module: 'mocks/claude', kind: 'route', exports: ['POST'] }],
  admin: {
    nav: [{ label: 'Assistant transcripts', href: '/admin/assistant', icon: 'sparkles', order: NAV_BANDS.customers + 40, permission: 'customers.read' }],
    pages: [
      { path: '/admin/assistant', module: 'routes/admin-transcripts', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/assistant/[id]', module: 'routes/admin-transcript', kind: 'page', exports: ['default', 'generateMetadata'] },
    ],
  },
  settings: {
    schema: assistantSettingsSchema,
    actions: [{ id: 'test-connection', label: 'Test the assistant', kind: 'test-connection', run: () => import('./server/actions').then((m) => m.testConnectionAction) }],
  },
  permissions: ['customers.read', 'settings.read', 'settings.write', 'settings.secrets'],
  jobs: {
    'ai-assistant.prune': { handler: () => import('./server/actions').then((m) => m.pruneJob), options: { policy: 'singleton' } },
  },
  schedules: [{ job: 'ai-assistant.prune', cron: '40 3 * * *' }],
  emits: ['integration.failed'],
  healthChecks: [{ id: 'ai-assistant', label: 'Shopping assistant', critical: false, readiness: false, run: () => import('./server/actions').then((m) => m.assistantHealth) }],
});
