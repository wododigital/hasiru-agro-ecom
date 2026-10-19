import { AuditPage } from '@ecomkit/admin-shell/admin';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AuditPage searchParams={searchParams} />;
}
