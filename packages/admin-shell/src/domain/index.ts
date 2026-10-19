import type { Permission, StaffRole } from '@ecomkit/core/contracts';

export * from './extensions';
export * from './nav';
export * from './settings-form';

/** Result every admin form island renders: a message, plus field errors keyed by field name. */
export interface FormState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}
export const IDLE: FormState = { ok: true, message: '' };

// ---- audit ----------------------------------------------------------------

export interface AuditChange {
  key: string;
  before: unknown;
  after: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Field-level changes between two audit snapshots. Objects compare key by key (sorted); anything else is one
 * change under "value". Unchanged keys are left out.
 */
export function auditChanges(before: unknown, after: unknown): AuditChange[] {
  // A created or deleted record has one side null: compare its fields against nothing.
  if (before == null && isRecord(after)) before = {};
  if (after == null && isRecord(before)) after = {};
  if (!isRecord(before) || !isRecord(after)) {
    return JSON.stringify(before ?? null) === JSON.stringify(after ?? null) ? [] : [{ key: 'value', before: before ?? null, after: after ?? null }];
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.flatMap((key) =>
    JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null) ? [] : [{ key, before: before[key] ?? null, after: after[key] ?? null }],
  );
}

// ---- staff (port implemented by the auth module) ------------------------------------------------

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  twoFactorEnabled: boolean;
  disabled: boolean;
  invitePending: boolean;
  createdAt: Date;
}

/**
 * What the staff and roles screens need. `@ecomkit/auth/server` exports functions with exactly these names and
 * shapes; the host page passes that module in. Every method checks `staff.manage` itself.
 */
export interface StaffAdmin {
  listStaff(): Promise<StaffMember[]>;
  inviteStaff(input: { email: string; name: string; role: StaffRole }): Promise<unknown>;
  setStaffRole(userId: string, role: StaffRole): Promise<unknown>;
  setStaffDisabled(userId: string, disabled: boolean): Promise<unknown>;
  resendInvite(userId: string): Promise<unknown>;
  getRoleMatrix(): Promise<Record<StaffRole, Permission[]>>;
  setRolePermissions(role: StaffRole, permissions: readonly string[]): Promise<unknown>;
}

/** Only the owner holds these; the roles screen never grants them to another role. */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ['settings.secrets', 'staff.manage'];

/** Human labels for roles (admin copy). */
export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  catalog_editor: 'Catalog editor',
  fulfilment: 'Fulfilment',
  support: 'Support',
};
