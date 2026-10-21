import { AccountLayout } from '@ecomkit/auth/ui';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
// The boundary pattern '../../*/src/**' also matches this app-internal path (it is not another package).
// eslint-disable-next-line no-restricted-imports
import { registry } from '../../../src/generated/registry';

// Account links appear only for pages an enabled module declares (orders, profile, addresses, land, reviews).
const pagePaths = registry.modules.flatMap((m) => (m.routes ?? []).filter((r) => r.kind === 'page').map((r) => r.path));

// Rendered per request, no static shell, so the nonce CSP covers every script (WP-37, see proxy.ts NONCE_PREFIXES).
export const instant = false;

export default async function Layout({ children }: { children: ReactNode }) {
  await connection();
  return <AccountLayout pagePaths={pagePaths}>{children}</AccountLayout>;
}
