import type { Metadata } from 'next';
import { ReviewsModerationPage } from '../admin/ReviewsAdmin';

export function generateMetadata(): Metadata {
  return { title: 'Reviews' };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReviewsModerationPage searchParams={await searchParams} />;
}
