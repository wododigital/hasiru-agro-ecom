import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

// Admin root for the proof store: neutral palette via data-surface, never indexed. There is no admin-shell here, so
// this layout supplies the Suspense boundary that module admin pages expect around their request-time viewer check.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="admin">
      <Suspense>{children}</Suspense>
    </div>
  );
}
