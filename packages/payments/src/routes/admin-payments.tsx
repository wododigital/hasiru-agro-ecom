import type { Metadata } from 'next';
import { PaymentsPage } from '../admin/PaymentsPage';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export function generateMetadata(): Metadata {
  return { title: 'Payments' };
}

export default function AdminPaymentsRoute(props: Props) {
  return <PaymentsPage {...props} />;
}
