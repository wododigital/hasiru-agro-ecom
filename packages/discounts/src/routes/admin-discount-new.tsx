import type { Metadata } from 'next';
import { DiscountEditPage } from '../admin/DiscountEditPage';

export function generateMetadata(): Metadata {
  return { title: 'New discount' };
}

export default function AdminDiscountNewRoute() {
  return <DiscountEditPage id={null} />;
}
