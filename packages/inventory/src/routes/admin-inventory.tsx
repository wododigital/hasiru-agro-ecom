import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InventoryListPage } from '../admin/InventoryListPage';

export function generateMetadata(): Metadata {
  return { title: 'Inventory' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission('inventory.read').catch((err: unknown) => {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  });
  return <InventoryListPage searchParams={await searchParams} />;
}
