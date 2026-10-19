import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Admin root: neutral palette via data-surface (tokens in @ecomkit/ui), never indexed.
// Staff gating lives in (admin)/admin/layout.tsx (admin-shell) and in every action.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div data-surface="admin">{children}</div>;
}
