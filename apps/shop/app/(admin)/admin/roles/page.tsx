import { RolesPage } from '@ecomkit/admin-shell/admin';
import type { FormState } from '@ecomkit/admin-shell/domain';
import { staffForms } from '@ecomkit/admin-shell/server';
import * as auth from '@ecomkit/auth/server';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Roles' };

async function save(_prev: FormState, form: FormData) {
  'use server';
  return staffForms.setRolePermissions(auth, form);
}

export default function Page() {
  return <RolesPage staff={auth} save={save} />;
}
