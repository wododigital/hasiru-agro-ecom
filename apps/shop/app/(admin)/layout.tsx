import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

// Admin root: neutral palette via data-surface (tokens in @ecomkit/ui), never indexed.
// Staff gating lives in (admin)/admin/layout.tsx (admin-shell) and in every action.
export const metadata: Metadata = { robots: { index: false, follow: false } };
// Rendered per request, never from a static shell: the nonce CSP (proxy.ts) only covers scripts rendered for the
// request (WP-37). `instant = false` opts these private pages out of the static-shell check.
export const instant = false;

export default async function AdminRootLayout({ children }: { children: ReactNode }) {
  await connection();
  return <div data-surface="admin">{children}</div>;
}
