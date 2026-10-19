import { AdminLayout } from '@ecomkit/admin-shell/admin';
import { searchAdmin } from '@ecomkit/admin-shell/server';
import type { ReactNode } from 'react';
// The boundary pattern '../../*/src/**' also matches this app-internal path (it is not another package).
// eslint-disable-next-line no-restricted-imports
import { registry } from '../../../src/generated/registry';

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
