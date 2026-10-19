import { defineModule } from './define';

/** The core module itself. /api/health/* are hand-written in the app (monitoring owns them). */
export default defineModule({
  id: 'core',
  dependsOn: [],
  schema: () => import('../schema'),
  routes: [{ path: '/api/internal/revalidate', module: 'routes/revalidate', kind: 'route', exports: ['POST'] }],
  permissions: ['settings.read', 'settings.write', 'settings.secrets', 'audit.read', 'jobs.retry'],
  jobs: {
    'core.prune': { handler: () => import('../jobs/prune').then((m) => m.pruneJob) },
  },
  schedules: [{ job: 'core.prune', cron: '30 3 * * *' }],
});
