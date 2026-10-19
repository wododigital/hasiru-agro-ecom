import type { Metadata } from 'next';
import { MessagesPage } from '../admin/pages';

export const generateMetadata = (): Metadata => ({ title: 'Message log' });

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <MessagesPage searchParams={await searchParams} />;
}
