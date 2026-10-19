import 'server-only';

// Public server API of @ecomkit/admin-shell. Functions that need the module list take the app registry.
export { failure, NO_ACCESS, requestMeta, requireAdmin, type AdminAccess } from './access';
export { loadAudit, type AuditParams } from './audit';
export { hasSearch, searchAdmin, type SearchGroup } from './search';
export {
  loadSettingsView,
  runSettingsAction,
  saveSettings,
  settingsIndex,
  settingsTitle,
  type ActionOutcome,
  type SettingsActionView,
  type SettingsFieldView,
  type SettingsView,
} from './settings';
export { staffForms } from './staff';
