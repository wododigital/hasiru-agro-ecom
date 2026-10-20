import { SettingsLayout } from '@ecomkit/admin-shell/admin';
import type { ReactNode } from 'react';
// eslint-disable-next-line no-restricted-imports
import { registry } from '../../../../src/generated/registry';

// Shopify-style settings layer (own left list, close back to the admin); staff, roles and audit live in it too.
export default function Layout({ children }: { children: ReactNode }) {
  return <SettingsLayout registry={registry}>{children}</SettingsLayout>;
}
