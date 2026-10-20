import type { Metadata } from 'next';
import { AbandonedCheckoutsPage } from '../admin/pages';

export function generateMetadata(): Metadata {
  return { title: 'Abandoned checkouts' };
}

export default function AdminAbandonedCheckoutsRoute() {
  return <AbandonedCheckoutsPage />;
}
