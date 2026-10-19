import { PERMISSIONS, STAFF_ROLES, type StaffRole } from '@ecomkit/core/contracts';
import { Badge, Checkbox, DataTable, FormField, Input, Select, type Column } from '@ecomkit/ui';
import { parseTableParams } from '@ecomkit/ui/domain';
import { OWNER_ONLY_PERMISSIONS, ROLE_LABELS, type StaffAdmin, type StaffMember } from '../domain';
import { requireAdmin } from '../server/access';
import { ActionForm, type FormAction } from './ActionFormIsland';
import { NoAccess, PageHeader, PageSkeleton } from './PageHeader';
import { Suspense } from 'react';

const PAGE_SIZE = 50;
const STATUSES = ['active', 'invited', 'disabled'] as const;
const statusOf = (m: StaffMember) => (m.disabled ? 'disabled' : m.invitePending ? 'invited' : 'active');
const when = (d: Date) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(d);

function RoleSelect({ defaultValue, id, label }: { defaultValue?: StaffRole; id?: string; label?: string }) {
  return (
    <Select id={id} name="role" defaultValue={defaultValue} aria-label={label} className="py-1.5">
      {STAFF_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </Select>
  );
}

export interface StaffActions {
  invite: FormAction;
  setRole: FormAction;
  setDisabled: FormAction;
  resendInvite: FormAction;
}

/**
 * /admin/staff: staff list (URL-bound search, role and status filters, sort: the DataTable pattern every admin
 * list follows), invite form and per-person role, disable and resend-invite actions. Owner only (staff.manage).
 */
export function StaffPage(props: StaffPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StaffContent {...props} />
    </Suspense>
  );
}

export interface StaffPageProps {
  staff: StaffAdmin;
  actions: StaffActions;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function StaffContent({ staff, actions, searchParams }: StaffPageProps) {
  const access = await requireAdmin('staff.manage');
  if (access.state === 'forbidden') return <NoAccess title="Staff" />;
  const params = parseTableParams(await searchParams, { filters: { role: STAFF_ROLES, status: STATUSES }, sorts: ['name', 'role', 'createdAt'], defaultSort: { id: 'name', dir: 'asc' } });

  const q = params.q.toLowerCase();
  const dir = params.dir === 'asc' ? 1 : -1;
  const all = (await staff.listStaff())
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    .filter((m) => !params.filters.role || m.role === params.filters.role)
    .filter((m) => !params.filters.status || statusOf(m) === params.filters.status)
    .sort((a, b) => {
      const key = params.sort as 'name' | 'role' | 'createdAt';
      const cmp = key === 'createdAt' ? a.createdAt.getTime() - b.createdAt.getTime() : String(a[key]).localeCompare(String(b[key]));
      return cmp * dir || a.id.localeCompare(b.id);
    });
  const rows = all.slice((params.page - 1) * PAGE_SIZE, params.page * PAGE_SIZE);
  const self = access.viewer.userId;

  const columns: Column<StaffMember>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      cell: (m) => (
        <span className="flex flex-col">
          <span className="font-medium">{m.name}</span>
          <span className="text-xs text-muted">{m.email}</span>
        </span>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      sortable: true,
      cell: (m) =>
        m.id === self ? (
          ROLE_LABELS[m.role]
        ) : (
          <ActionForm action={actions.setRole} submitLabel="Change" submitVariant="ghost" className="flex-row items-center gap-1">
            <input type="hidden" name="userId" value={m.id} />
            <RoleSelect defaultValue={m.role} label={`Role for ${m.name}`} />
          </ActionForm>
        ),
    },
    {
      id: 'security',
      header: 'Sign-in',
      cell: (m) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={statusOf(m) === 'active' ? 'success' : statusOf(m) === 'invited' ? 'warning' : 'danger'}>{statusOf(m)}</Badge>
          <Badge tone={m.twoFactorEnabled ? 'neutral' : 'warning'}>{m.twoFactorEnabled ? 'Authenticator on' : 'No authenticator'}</Badge>
        </span>
      ),
    },
    { id: 'createdAt', header: 'Added', sortable: true, cell: (m) => when(m.createdAt) },
    {
      id: 'actions',
      header: 'Actions',
      cell: (m) =>
        m.id === self ? (
          <span className="text-xs text-muted">This is you</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            <ActionForm action={actions.setDisabled} submitLabel={m.disabled ? 'Enable' : 'Disable'} submitVariant={m.disabled ? 'outline' : 'danger'}>
              <input type="hidden" name="userId" value={m.id} />
              <input type="hidden" name="disabled" value={String(!m.disabled)} />
            </ActionForm>
            {m.invitePending ? (
              <ActionForm action={actions.resendInvite} submitLabel="Resend invite" submitVariant="outline">
                <input type="hidden" name="userId" value={m.id} />
              </ActionForm>
            ) : null}
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader title="Staff" description="Invite people, set their role, or disable an account. Staff sign in with a password and an authenticator app; sessions end after 12 hours." />
      <section className="rounded-md border border-border bg-surface p-4 md:p-5">
        <h2 className="mb-3 text-base font-semibold text-primary">Invite staff</h2>
        <ActionForm action={actions.invite} submitLabel="Send invite" labels={{ email: 'Email', name: 'Name', role: 'Role' }} cta="staff-invite">
          <div className="grid gap-3 md:grid-cols-3">
            <FormField id="invite-name" label="Name" required>
              {(c) => <Input {...c} name="name" required maxLength={120} autoComplete="off" />}
            </FormField>
            <FormField id="invite-email" label="Email" required>
              {(c) => <Input {...c} name="email" type="email" required autoComplete="off" />}
            </FormField>
            <FormField id="invite-role" label="Role">
              {(c) => <RoleSelect id={c.id} defaultValue="support" />}
            </FormField>
          </div>
        </ActionForm>
      </section>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        params={params}
        total={all.length}
        pageSize={PAGE_SIZE}
        basePath="/admin/staff"
        filters={[
          { key: 'role', label: 'Role', options: STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) },
          { key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: s })) },
        ]}
      />
    </>
  );
}

/** /admin/roles: what each role may do. Owner is fixed; the others are edited per role. Owner only. */
export function RolesPage(props: { staff: StaffAdmin; save: FormAction }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RolesContent {...props} />
    </Suspense>
  );
}

async function RolesContent({ staff, save }: { staff: StaffAdmin; save: FormAction }) {
  const access = await requireAdmin('staff.manage');
  if (access.state === 'forbidden') return <NoAccess title="Roles" />;
  const matrix = await staff.getRoleMatrix();
  return (
    <>
      <PageHeader title="Roles" description="Changes apply on each staff member's next page load. Secrets and staff management stay with the owner." />
      <div className="grid gap-4 xl:grid-cols-2">
        {STAFF_ROLES.map((role) => (
          <section key={role} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
            <h2 className="text-base font-semibold text-primary">{ROLE_LABELS[role]}</h2>
            {role === 'owner' ? (
              <p className="text-sm text-muted">Every permission, including secrets and staff. Not editable.</p>
            ) : (
              <ActionForm action={save} submitLabel={`Save ${ROLE_LABELS[role]}`} cta={`roles-save-${role}`}>
                <input type="hidden" name="role" value={role} />
                <fieldset className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  <legend className="sr-only">{`Permissions for ${ROLE_LABELS[role]}`}</legend>
                  {PERMISSIONS.map((p) => (
                    <label key={p} className="flex items-center gap-2 font-mono text-xs">
                      <Checkbox name="permissions" value={p} defaultChecked={matrix[role]?.includes(p)} disabled={OWNER_ONLY_PERMISSIONS.includes(p)} />
                      {p}
                    </label>
                  ))}
                </fieldset>
              </ActionForm>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
