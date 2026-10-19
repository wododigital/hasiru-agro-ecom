import { notFound } from 'next/navigation';
import { ProductEditPage } from '../admin/ProductEditor';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <ProductEditPage id={id} />;
}
