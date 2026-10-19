import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InsightsPage } from '../admin/InsightsPage';

export function generateMetadata(): Metadata {
  return { title: 'Search insights', robots: { index: false, follow: false } };
}

export default function SearchInsightsRoute() {
  return (
    <Suspense>
      <InsightsPage />
    </Suspense>
  );
}
