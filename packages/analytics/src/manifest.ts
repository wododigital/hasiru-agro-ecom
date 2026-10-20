import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';

const admin = () => import('./admin/kpis');
const tabs = () => import('./admin/tabs');

/**
 * First-party analytics: the /b.js collector, the /api/beacon-ingest endpoint, sessions, monthly-partitioned raw
 * events (90 days), nightly rollups and the Analytics admin page. Optional: customers (consent for identity
 * linking, wired by the host). Overview, Reports (every module's `reports`) and Live view under /admin/analytics.
 */
export default defineModule({
  id: 'analytics',
  dependsOn: ['core', 'ui'],
  optional: ['customers', 'orders'],
  schema: () => import('./schema'),
  routes: [
    { path: '/b.js', module: 'routes/beacon-script', kind: 'route', exports: ['GET'] },
    { path: '/api/beacon-ingest', module: 'routes/beacon-ingest', kind: 'route', exports: ['POST'] },
  ],
  admin: {
    nav: [
      { label: 'Analytics', href: '/admin/analytics', icon: 'chart-line', order: NAV_BANDS.analytics, permission: 'analytics.read' },
      { label: 'Reports', href: '/admin/analytics/reports', icon: 'file-chart-column', order: NAV_BANDS.analytics + 10, permission: 'analytics.read' },
      { label: 'Live view', href: '/admin/analytics/live', icon: 'radio', order: NAV_BANDS.analytics + 20, permission: 'analytics.read' },
      { label: 'Journeys', href: '/admin/analytics/reports/analytics.journeys', icon: 'route', order: NAV_BANDS.analytics + 30, permission: 'analytics.read' },
    ],
    pages: [
      { path: '/admin/analytics', module: 'routes/admin-analytics', kind: 'page', exports: ['default'] },
      { path: '/admin/analytics/reports', module: 'routes/admin-analytics-reports', kind: 'page', exports: ['default'] },
      { path: '/admin/analytics/reports/[id]', module: 'routes/admin-analytics-report', kind: 'page', exports: ['default'] },
      { path: '/admin/analytics/live', module: 'routes/admin-analytics-live', kind: 'page', exports: ['default'] },
    ],
  },
  // KPI cards (Home strip and Analytics overview: ids with `.kpi.`) and this module's reports on /admin/analytics/reports.
  dashboardWidgets: [
    { id: 'analytics.kpi.sessions', title: 'Sessions', order: 1, size: 'sm', permission: 'analytics.read', component: () => admin().then((m) => m.SessionsKpi) },
    { id: 'analytics.kpi.conversion', title: 'Conversion rate', order: 4, size: 'sm', permission: 'analytics.read', component: () => admin().then((m) => m.ConversionKpi) },
  ],
  reports: [
    { id: 'analytics.conversion-funnel', title: 'Conversion funnel', group: 'behaviour', permission: 'analytics.read', component: () => tabs().then((m) => m.FunnelTab) },
    { id: 'analytics.sessions-by-source', title: 'Sessions by source', group: 'acquisition', permission: 'analytics.read', component: () => tabs().then((m) => m.TrafficTab) },
    { id: 'analytics.search-terms', title: 'Search terms', group: 'behaviour', permission: 'analytics.read', component: () => tabs().then((m) => m.SearchTab) },
    { id: 'analytics.journeys', title: 'Journeys', group: 'behaviour', permission: 'analytics.read', component: () => tabs().then((m) => m.JourneysTab) },
    { id: 'analytics.planner', title: 'Farm planner and calculators', group: 'behaviour', permission: 'analytics.read', component: () => tabs().then((m) => m.WizardTab) },
    { id: 'analytics.attention', title: 'Attention and clicks', group: 'behaviour', permission: 'analytics.read', component: () => tabs().then((m) => m.AttentionTab) },
    { id: 'analytics.bots', title: 'Automated visitors', group: 'acquisition', permission: 'analytics.read', component: () => tabs().then((m) => m.BotsTab) },
    { id: 'analytics.web-vitals', title: 'Web vitals', group: 'performance', permission: 'analytics.read', component: () => tabs().then((m) => m.VitalsTab) },
  ],
  permissions: ['analytics.read'],
  jobs: {
    'analytics.create-partition': { handler: () => import('./server/partitions').then((m) => m.createPartitionJob), options: { policy: 'singleton' } },
    'analytics.rollup-daily': { handler: () => import('./server/rollup').then((m) => m.rollupDailyJob), options: { policy: 'singleton' } },
  },
  schedules: [
    { job: 'analytics.create-partition', cron: '0 2 25 * *' },
    { job: 'analytics.rollup-daily', cron: '30 1 * * *' },
  ],
  on: {
    'consent.changed': () => import('./server/consent').then((m) => m.onConsentChanged),
  },
});
