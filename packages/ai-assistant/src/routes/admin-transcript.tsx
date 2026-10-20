import type { Metadata } from 'next';
import { TranscriptPage } from '../admin';

export function generateMetadata(): Metadata {
  return { title: 'Assistant conversation' };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TranscriptPage id={id} />;
}
