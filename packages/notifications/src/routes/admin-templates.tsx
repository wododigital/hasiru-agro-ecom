import type { Metadata } from 'next';
import { TemplatesPage } from '../admin/pages';

export const generateMetadata = (): Metadata => ({ title: 'Message templates' });

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <TemplatesPage searchParams={await searchParams} />;
}
