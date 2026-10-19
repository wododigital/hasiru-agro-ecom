import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import { notFound } from 'next/navigation';

/** Health screens are for staff with health.read; everyone else gets a plain 404 (the admin never admits it exists). */
export async function requireHealthRead(): Promise<void> {
  await requirePermission('health.read').catch((err: unknown) => {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  });
}
