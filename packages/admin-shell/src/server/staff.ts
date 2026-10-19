import { PERMISSIONS, STAFF_ROLES } from '@ecomkit/core/contracts';
import { zodAction } from '@ecomkit/core/validation';
import { z } from 'zod';
import { OWNER_ONLY_PERMISSIONS, type FormState, type StaffAdmin } from '../domain';
import { failure, NO_ACCESS } from './access';

/**
 * Form bodies for the staff and roles screens. Each validates its FormData with zod, checks staff.manage,
 * and calls the auth module through the `StaffAdmin` port (which checks the permission again).
 */

const role = z.enum(STAFF_ROLES);
const userId = z.string().min(1).max(64);

const inviteSchema = z.object({ email: z.email().max(200), name: z.string().trim().min(1).max(120), role });
const roleSchema = z.object({ userId, role });
const toggleSchema = z.object({ userId, disabled: z.enum(['true', 'false']).transform((v) => v === 'true') });
const resendSchema = z.object({ userId });
// Checkboxes: none ticked posts nothing, one ticked posts a single value.
const matrixSchema = z.object({
  role: role.exclude(['owner']),
  permissions: z.preprocess((v) => (v === undefined ? [] : [v].flat()), z.array(z.enum(PERMISSIONS).refine((p) => !OWNER_ONLY_PERMISSIONS.includes(p), 'Only the owner can hold this permission.'))),
});

async function run<S extends z.ZodType>(schema: S, form: FormData, route: string, body: (data: z.infer<S>) => Promise<string>): Promise<FormState> {
  try {
    const r = await zodAction(schema, body, { permission: 'staff.manage' })(form);
    if (r.ok) return { ok: true, message: r.data };
    return r.formError === 'forbidden' ? { ok: false, message: NO_ACCESS } : { ok: false, message: 'Check the highlighted fields.', fieldErrors: r.fieldErrors };
  } catch (err) {
    return failure(err, route);
  }
}

export const staffForms = {
  invite: (staff: StaffAdmin, form: FormData) =>
    run(inviteSchema, form, '/admin/staff', async (d) => {
      await staff.inviteStaff(d);
      return `Invite sent to ${d.email}.`;
    }),
  setRole: (staff: StaffAdmin, form: FormData) =>
    run(roleSchema, form, '/admin/staff', async (d) => {
      await staff.setStaffRole(d.userId, d.role);
      return 'Role updated.';
    }),
  setDisabled: (staff: StaffAdmin, form: FormData) =>
    run(toggleSchema, form, '/admin/staff', async (d) => {
      await staff.setStaffDisabled(d.userId, d.disabled);
      return d.disabled ? 'Account disabled and signed out everywhere.' : 'Account enabled.';
    }),
  resendInvite: (staff: StaffAdmin, form: FormData) =>
    run(resendSchema, form, '/admin/staff', async (d) => {
      await staff.resendInvite(d.userId);
      return 'A new invite link was sent.';
    }),
  setRolePermissions: (staff: StaffAdmin, form: FormData) =>
    run(matrixSchema, form, '/admin/roles', async (d) => {
      await staff.setRolePermissions(d.role, d.permissions);
      return 'Permissions saved.';
    }),
};
