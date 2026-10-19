import { DashboardPage } from '@ecomkit/admin-shell/admin';
import type { Metadata } from 'next';
// eslint-disable-next-line no-restricted-imports
import { registry } from '../../../src/generated/registry';

export const metadata: Metadata = { title: 'Home' };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DashboardPage registry={registry} searchParams={searchParams} />;
}
