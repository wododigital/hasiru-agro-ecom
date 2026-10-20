import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ErpSyncPage } from '../admin/pages';

export function generateMetadata(): Metadata {
  return { title: 'ERP sync' };
}

export default async function Page() {
  await requirePermission('health.read').catch((err: unknown) => {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  });
  return <ErpSyncPage />;
}
