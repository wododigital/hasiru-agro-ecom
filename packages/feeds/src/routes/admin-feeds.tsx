import type { Metadata } from 'next';
import { FeedsPage } from '../admin/FeedsPage';

export function generateMetadata(): Metadata {
  return { title: 'Product feeds' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <FeedsPage searchParams={await searchParams} />;
}
