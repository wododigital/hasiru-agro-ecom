/** Permission strings (frozen catalogue, see docs/CONVENTIONS.md). */
export const PERMISSIONS = [
  'orders.read',
  'orders.write',
  'orders.refund',
  'orders.dispatch',
  'products.read',
  'products.write',
  'inventory.read',
  'inventory.write',
  'pricing.write',
  'media.write',
  'content.write',
  'reviews.moderate',
  'customers.read',
  'customers.write',
  'customers.export',
  'enquiries.read',
  'enquiries.write',
  'marketing.write',
  'analytics.read',
  'health.read',
  'jobs.retry',
  'settings.read',
  'settings.write',
  'settings.secrets',
  'staff.manage',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const STAFF_ROLES = ['owner', 'manager', 'catalog_editor', 'fulfilment', 'support'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

const all = PERMISSIONS;
/** Default role matrix. `@ecomkit/auth` seeds `auth_role_permission` from this; owners may edit rows later. */
export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = {
  owner: all,
  manager: all.filter((p) => p !== 'settings.secrets' && p !== 'staff.manage'),
  catalog_editor: [
    'products.read',
    'products.write',
    'inventory.read',
    'inventory.write',
    'pricing.write',
    'media.write',
    'content.write',
    'reviews.moderate',
  ],
  fulfilment: [
    'orders.read',
    'orders.write',
    'orders.dispatch',
    'products.read',
    'inventory.read',
    'inventory.write',
    'customers.read',
    'enquiries.read',
  ],
  support: [
    'orders.read',
    'products.read',
    'inventory.read',
    'customers.read',
    'customers.write',
    'enquiries.read',
    'enquiries.write',
    'reviews.moderate',
  ],
};

export interface GuestViewer {
  kind: 'guest';
}
export interface CustomerViewer {
  kind: 'customer';
  userId: string;
  customerId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}
export interface StaffViewer {
  kind: 'staff';
  userId: string;
  name: string;
  email: string;
  role: StaffRole;
  permissions: readonly Permission[];
}
export type Viewer = GuestViewer | CustomerViewer | StaffViewer;

/** Implemented by `@ecomkit/auth` (service key `auth`); consumed through `@ecomkit/core/auth-context`. */
export interface AuthContext {
  getViewer(): Promise<Viewer>;
  /** Throws a 403-mapped error when the viewer is not staff with the permission. */
  requirePermission(permission: Permission): Promise<StaffViewer>;
  /** Throws a 404-mapped error when the viewer is not the customer that owns the entity. */
  requireOwner(customerId: string): Promise<CustomerViewer>;
}
