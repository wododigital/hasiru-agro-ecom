import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InventoryDetailPage } from '../admin/InventoryDetailPage';

export function generateMetadata(): Metadata {
  return { title: 'Inventory: variant' };
}

export default async function Page({ params }: { params: Promise<{ variantId: string }> }) {
  await requirePermission('inventory.read').catch((err: unknown) => {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  });
  return <InventoryDetailPage variantId={(await params).variantId} />;
}
