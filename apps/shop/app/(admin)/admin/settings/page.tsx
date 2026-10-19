import { SettingsIndexPage } from '@ecomkit/admin-shell/admin';
import type { Metadata } from 'next';
// eslint-disable-next-line no-restricted-imports
import { registry } from '../../../../src/generated/registry';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return <SettingsIndexPage registry={registry} />;
}
