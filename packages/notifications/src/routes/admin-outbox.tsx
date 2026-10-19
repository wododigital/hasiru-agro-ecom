import type { Metadata } from 'next';
import { OutboxPage } from '../admin/pages';

export const generateMetadata = (): Metadata => ({ title: 'Dev outbox' });

/** Development and test builds only (404 in production unless ENABLE_MOCKS=1). */
export default function Page() {
  return <OutboxPage />;
}
