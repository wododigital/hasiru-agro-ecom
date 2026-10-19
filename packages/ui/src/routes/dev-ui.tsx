import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StoriesPage } from '../admin/StoriesPage';

export function generateMetadata(): Metadata {
  return { title: 'UI primitives' };
}

/** /admin/dev/ui: every primitive in its states. Development and test builds only. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_MOCKS !== '1') notFound();
  return <StoriesPage />;
}
