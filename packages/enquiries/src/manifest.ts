import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';

/**
 * Generic enquiry pipeline: a no-JS public form with private uploads, statuses, assignee, remarks and
 * staleness. Leads go through the customers module (wired at boot with `configureEnquiries`); staff and
 * customer notifications subscribe to `enquiry.created`.
 */
export default defineModule({
  id: 'enquiries',
  dependsOn: ['core', 'media'],
  optional: ['notifications', 'customers'],
  schema: () => import('./schema'),
  routes: [
    { path: '/api/enquiry', module: 'routes/enquiry-api', kind: 'route', exports: ['POST'] },
    { path: '/api/admin/enquiries/attachments/[id]', module: 'routes/admin-attachment', kind: 'route', exports: ['GET'] },
  ],
  admin: {
    nav: [{ label: 'Enquiries', href: '/admin/enquiries', icon: 'inbox', order: NAV_BANDS.enquiries, permission: 'enquiries.read' }],
    pages: [
      { path: '/admin/enquiries', module: 'routes/admin-enquiries', kind: 'page', exports: ['default', 'generateMetadata'] },
      { path: '/admin/enquiries/[id]', module: 'routes/admin-enquiry', kind: 'page', exports: ['default', 'generateMetadata'] },
    ],
  },
  // Home "Things to do" (read structurally by admin-shell).
  adminTodos: [{ id: 'enquiries.new', label: 'new enquiries', href: '/admin/enquiries?status=new', order: 30, permission: 'enquiries.read', count: () => import('./admin/todos').then((m) => m.newEnquiries) }],
  permissions: ['enquiries.read', 'enquiries.write'],
  emits: ['enquiry.created', 'enquiry.status_changed'],
  dashboardWidgets: [
    {
      id: 'enquiries.staleness',
      title: 'Last enquiry',
      order: 30,
      size: 'sm',
      permission: 'enquiries.read',
      component: () => import('./admin/EnquiriesAdmin').then((m) => m.EnquiryStalenessWidget),
    },
  ],
});
