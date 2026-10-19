import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { DiscountEditPage } from '../admin/DiscountEditPage';

type Props = { params: Promise<{ id: string }> };

export function generateMetadata(): Metadata {
  return { title: 'Edit discount' };
}

export default async function AdminDiscountEditRoute({ params }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <DiscountEditPage id={id} />;
}
