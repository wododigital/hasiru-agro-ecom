import type { Metadata } from 'next';
import { TranscriptsPage } from '../admin';

export function generateMetadata(): Metadata {
  return { title: 'Assistant transcripts' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <TranscriptsPage searchParams={await searchParams} />;
}
