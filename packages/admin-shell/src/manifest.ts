import { NAV_BANDS } from '@ecomkit/core/contracts';
import { defineModule } from '@ecomkit/core/manifest';

/**
 * The admin frame: sidebar from every enabled module's `admin.nav`, global search, the settings renderer
 * (/admin/settings/<module> from each manifest's `settings`), audit viewer, staff and roles screens and the
 * dashboard grid of `dashboardWidgets`. No tables. Its pages are thin host files (see README), because they
 * need the app's registry.
 */
export default defineModule({
  id: 'admin-shell',
  dependsOn: ['core', 'ui', 'auth'],
  admin: {
    nav: [
      { label: 'Home', href: '/admin', icon: 'house', order: NAV_BANDS.home },
      { label: 'Settings', href: '/admin/settings', icon: 'settings', order: NAV_BANDS.settings, permission: 'settings.read' },
      { label: 'Staff', href: '/admin/staff', icon: 'users', order: NAV_BANDS.settings + 80, permission: 'staff.manage' },
      { label: 'Roles', href: '/admin/roles', icon: 'shield-check', order: NAV_BANDS.settings + 85, permission: 'staff.manage' },
      { label: 'Audit log', href: '/admin/audit', icon: 'scroll-text', order: NAV_BANDS.settings + 90, permission: 'audit.read' },
    ],
  },
  permissions: ['settings.read', 'settings.write', 'settings.secrets', 'audit.read'],
});
