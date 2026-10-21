import { connection } from 'next/server';
import type { ReactNode } from 'react';

// Rendered per request, no static shell, so the nonce CSP covers every script (WP-37, see proxy.ts NONCE_PREFIXES).
export const instant = false;

export default async function Layout({ children }: { children: ReactNode }) {
  await connection();
  return children;
}
