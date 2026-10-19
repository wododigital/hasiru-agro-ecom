import { AccountLayout } from '@ecomkit/auth/ui';
import type { ReactNode } from 'react';
// The boundary pattern '../../*/src/**' also matches this app-internal path (it is not another package).
// eslint-disable-next-line no-restricted-imports
import { registry } from '../../../src/generated/registry';

// Account links appear only for pages an enabled module declares (orders, profile, addresses, land, reviews).
const pagePaths = registry.modules.flatMap((m) => (m.routes ?? []).filter((r) => r.kind === 'page').map((r) => r.path));

export default function Layout({ children }: { children: ReactNode }) {
  return <AccountLayout pagePaths={pagePaths}>{children}</AccountLayout>;
}
