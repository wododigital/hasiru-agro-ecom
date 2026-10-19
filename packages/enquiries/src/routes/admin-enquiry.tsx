import type { Metadata } from 'next';
import { EnquiryDetailPage } from '../admin/EnquiriesAdmin';

export function generateMetadata(): Metadata {
  return { title: 'Enquiry' };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EnquiryDetailPage id={(await params).id} />;
}
