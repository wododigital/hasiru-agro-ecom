import { StaffPage } from '@ecomkit/admin-shell/admin';
import type { FormState } from '@ecomkit/admin-shell/domain';
import { staffForms } from '@ecomkit/admin-shell/server';
import * as auth from '@ecomkit/auth/server';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Staff' };

// The auth module implements the staff port (listStaff, inviteStaff, setStaffRole, ...); admin-shell renders it.
async function invite(_prev: FormState, form: FormData) {
  'use server';
  return staffForms.invite(auth, form);
}
async function setRole(_prev: FormState, form: FormData) {
  'use server';
  return staffForms.setRole(auth, form);
}
async function setDisabled(_prev: FormState, form: FormData) {
  'use server';
  return staffForms.setDisabled(auth, form);
}
async function resendInvite(_prev: FormState, form: FormData) {
  'use server';
  return staffForms.resendInvite(auth, form);
}

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <StaffPage staff={auth} actions={{ invite, setRole, setDisabled, resendInvite }} searchParams={searchParams} />;
}
