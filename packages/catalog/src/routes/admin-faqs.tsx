import { FaqsPage } from '../admin/Pages';
import type { SP } from './shared';

export default function Page({ searchParams }: { searchParams: SP }) {
  return <FaqsPage searchParams={searchParams} />;
}
