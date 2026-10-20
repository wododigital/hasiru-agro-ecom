import type { Metadata } from 'next';
import { TagsPage } from '../admin/TagsPage';

export function generateMetadata(): Metadata {
  return { title: 'Pixels & tags' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <TagsPage searchParams={await searchParams} />;
}
