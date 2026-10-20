import type { Metadata } from 'next';
import { ManualOrderPage } from '../admin';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export function generateMetadata(): Metadata {
  return { title: 'Manual order' };
}

export default async function AdminManualOrderRoute({ searchParams }: Props) {
  return <ManualOrderPage flags={await searchParams} />;
}
