import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';
import { notificationsSettingsSchema } from './settings';

export default defineModule({
  id: 'notifications',
  dependsOn: ['core'],
  schema: () => import('./schema'),
  routes: [
    { path: '/api/webhooks/whatsapp', module: 'routes/whatsapp-webhook', kind: 'route', exports: ['GET', 'POST'] },
    { path: '/api/auth/gmail/callback', module: 'routes/gmail-callback', kind: 'route', exports: ['GET'] },
  ],
  mockRoutes: [
    { path: '/api/_mock/meta/[...path]', module: 'mocks/meta', kind: 'route', exports: ['GET', 'POST'] },
    { path: '/api/_mock/gmail/[...path]', module: 'mocks/gmail', kind: 'route', exports: ['GET', 'POST'] },
  ],
  admin: {
    nav: [
      { label: 'Message log', href: '/admin/messages', icon: 'message-square', order: NAV_BANDS.health + 20, permission: 'settings.read' },
      { label: 'Message templates', href: '/admin/templates', icon: 'mail', order: NAV_BANDS.settings + 20, permission: 'settings.read' },
    ],
    pages: [
      { path: '/admin/messages', module: 'routes/admin-messages', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/templates', module: 'routes/admin-templates', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/dev/outbox', module: 'routes/admin-outbox', kind: 'page', exports: ['default', 'generateMetadata'] },
    ],
  },
  settings: {
    schema: notificationsSettingsSchema,
    actions: [
      { id: 'connect-gmail', label: 'Connect Gmail', kind: 'oauth-redirect', permission: 'settings.secrets', run: () => import('./server/gmail-oauth').then((m) => m.connectGmailAction) },
      { id: 'test-email', label: 'Send test email', kind: 'test-connection', run: () => import('./server/actions').then((m) => m.testEmailAction) },
      { id: 'test-whatsapp', label: 'Send test WhatsApp', kind: 'test-connection', run: () => import('./server/actions').then((m) => m.testWhatsappAction) },
      { id: 'sync-templates', label: 'Sync WhatsApp templates', kind: 'server-action', run: () => import('./server/actions').then((m) => m.syncTemplatesAction) },
      { id: 'submit-templates', label: 'Submit templates to WhatsApp', kind: 'server-action', run: () => import('./server/actions').then((m) => m.submitTemplatesAction) },
    ],
    customPanel: () => import('./admin/pages').then((m) => m.SettingsPanel),
  },
  // Home "Things to do" (read structurally by admin-shell).
  adminTodos: [{ id: 'notifications.failed', label: 'failed messages', href: '/admin/messages?status=failed', order: 40, permission: 'settings.read', count: () => import('./admin/todos').then((m) => m.failedMessages) }],
  permissions: ['settings.read', 'settings.write', 'settings.secrets'],
  jobs: {
    'notifications.deliver': { handler: () => import('./server/sender').then((m) => m.deliverJob), options: { retryLimit: 5, retryDelaySec: 30, retryBackoff: true, retryDelayMaxSec: 3600 } },
    'notifications.process-webhook': { handler: () => import('./server/whatsapp').then((m) => m.processWebhookJob) },
    'notifications.sync-templates': { handler: () => import('./server/whatsapp').then((m) => async () => void (await m.syncWhatsappTemplates())) },
  },
  schedules: [{ job: 'notifications.sync-templates', cron: '15 4 * * *' }],
  emits: ['message.sent', 'message.failed', 'integration.failed'],
  provides: { notifications: () => import('./server/sender').then((m) => m.sender) },
  healthChecks: [
    { id: 'notifications-email', label: 'Email (Gmail)', critical: false, readiness: false, run: () => import('./server/actions').then((m) => m.emailHealth) },
    { id: 'notifications-whatsapp', label: 'WhatsApp', critical: false, readiness: false, run: () => import('./server/actions').then((m) => m.whatsappHealth) },
    { id: 'notifications-otp', label: 'Sign-in codes', critical: false, readiness: false, run: () => import('./server/actions').then((m) => m.otpHealth) },
  ],
});
