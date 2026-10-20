// Admin screens. Server components unless named *Island; pages take the app registry and server actions as props.
export { DashboardPage, type DashboardPageProps } from '../dashboard/DashboardFrame';
export { ActionForm, type ActionFormProps, type FormAction } from './ActionFormIsland';
export { AdminLayout, type AdminLayoutProps } from './AdminLayout';
export { AuditPage } from './AuditPage';
export { NoAccess, PageHeader } from './PageHeader';
export { SettingsIndexPage, SettingsPage, type SettingsPageProps } from './SettingsPage';
export { SettingsLayout } from './SettingsLayout';
export { RolesPage, StaffPage, type StaffActions, type StaffPageProps } from './StaffPage';
