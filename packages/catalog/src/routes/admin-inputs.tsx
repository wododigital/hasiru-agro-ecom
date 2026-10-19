import { ProductsListPage } from '../admin/Pages';
import type { SP } from './shared';

export default function Page({ searchParams }: { searchParams: SP }) {
  return <ProductsListPage kind="input" searchParams={searchParams} />;
}
