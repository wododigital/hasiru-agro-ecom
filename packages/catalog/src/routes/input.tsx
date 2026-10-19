import { productPath } from '../domain/card';
import { getProductBySlug, productSlugs } from '../server/queries';
import { pageMetadata } from '../server/meta';
import { ProductPage } from '../ui/ProductPage';
import { atLeastOne, PLACEHOLDER_SLUG } from './shared';

type Params = Promise<{ slug: string }>;

export async function generateStaticParams() {
  return atLeastOne((await productSlugs('input')).map((slug) => ({ slug })), { slug: PLACEHOLDER_SLUG });
}

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const d = await getProductBySlug(slug);
  if (!d || d.product.kind !== 'input') return {};
  const p = d.product;
  return pageMetadata({
    title: p.seoTitle ?? p.name,
    description: p.seoDescription ?? p.shortDescription ?? p.name,
    path: productPath(p.kind, p.slug),
    type: 'product',
    noindex: p.noindex || p.status !== 'active',
  });
}

/** /input/[slug]: product detail. Old slugs 301 to the current one; hidden products 404. */
export default async function Page({ params }: { params: Params }) {
  const { slug } = await params;
  return <ProductPage slug={slug} kind="input" />;
}
