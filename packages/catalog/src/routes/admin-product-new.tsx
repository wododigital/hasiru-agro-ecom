import { ProductCreatePage } from '../admin/ProductEditor';
import type { SP } from './shared';

export default async function Page({ searchParams }: { searchParams: SP }) {
  const kind = (await searchParams).kind === 'input' ? 'input' : 'plant';
  return <ProductCreatePage kind={kind} />;
}
