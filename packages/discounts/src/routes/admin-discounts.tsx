import type { Metadata } from 'next';
import { DiscountsListPage } from '../admin/DiscountsListPage';

export function generateMetadata(): Metadata {
  return { title: 'Discounts' };
}

export default function AdminDiscountsRoute() {
  return <DiscountsListPage />;
}
