// Test viewers bound through core's auth-context, the seam the auth module fills at app boot.
import { ForbiddenError, NotFoundError, setAuthProvider } from '@ecomkit/core/auth-context';
import { ROLE_PERMISSIONS, type CustomerViewer, type Permission, type StaffRole, type StaffViewer, type Viewer } from '@ecomkit/core/contracts';
import { newId } from '@ecomkit/core/ids';

let current: Viewer = { kind: 'guest' };

setAuthProvider(async () => ({
  getViewer: async () => current,
  requirePermission: async (permission) => {
    if (current.kind !== 'staff' || !current.permissions.includes(permission)) throw new ForbiddenError();
    return current;
  },
  requireOwner: async (customerId) => {
    if (current.kind !== 'customer' || current.customerId !== customerId) throw new NotFoundError();
    return current;
  },
}));

export function asGuest(): void {
  current = { kind: 'guest' };
}

export function asCustomer(id = newId()): CustomerViewer {
  current = { kind: 'customer', userId: id, customerId: id, name: 'Test Customer', phone: null, email: null };
  return current;
}

/** `extra`: permissions an owner granted the role on top of the default matrix. */
export function asStaff(role: StaffRole, extra: readonly Permission[] = []): StaffViewer {
  current = { kind: 'staff', userId: newId(), name: role, email: `${role}@example.test`, role, permissions: [...ROLE_PERMISSIONS[role], ...extra] };
  return current;
}
