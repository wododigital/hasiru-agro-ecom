import { AdminLayout } from '@ecomkit/admin-shell/admin';
import { setAuthProvider } from '@ecomkit/core/auth-context';
import { searchAdmin } from '@ecomkit/admin-shell/server';
import type { ReactNode } from 'react';
// The boundary pattern '../../*/src/**' also matches this app-internal path (it is not another package).
// eslint-disable-next-line no-restricted-imports
import { registry } from '../../../src/generated/registry';

// Bind the auth module as core's viewer source (nothing else in the app did, so every request resolved as a guest).
// ponytail: bound here because admin is where it was proven; move to a shared root module when storefront needs it.
setAuthProvider(() => registry.service('auth'));

async function search(query: string) {
  'use server';
  return searchAdmin(registry, query);
}

// Staff gate, sidebar, top bar and toasts for every /admin page (the sign-in page renders bare).
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AdminLayout registry={registry} search={search} title="Hasiru Agro">
      {children}
    </AdminLayout>
  );
}
