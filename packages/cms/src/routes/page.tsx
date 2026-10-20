import { notFound } from 'next/navigation';
import { isPolicySlug } from '../domain';
import { cmsRuntime, getPage, publishedPages } from '../server';
import { CmsPageBody, NO_PAGE, pageMetadataFor } from '../ui';

type Props = { params: Promise<{ slug: string[] }> };
/** Pages with their own routes (about, contact, policies) are not served by the catch-all. */
const OWN_ROUTE = (slug: string) => slug === 'about' || slug === 'contact' || isPolicySlug(slug);

export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  try {
    const list = (await publishedPages()).filter((p) => !OWN_ROUTE(p.slug)).map((p) => ({ slug: p.slug.split('/') }));
    return list.length ? list : [{ slug: [NO_PAGE] }];
  } catch {
    return [{ slug: [NO_PAGE] }];
  }
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const key = slug.join('/');
  return OWN_ROUTE(key) ? {} : pageMetadataFor(await getPage(key));
}

/**
 * Catch-all for cms pages. Anything else that reaches it is a missing page: the bound seo capability answers a
 * redirect or logs the 404, before any streaming starts, so the status code is real.
 */
export default async function CmsCatchAllPage({ params }: Props) {
  const { slug } = await params;
  const key = slug.join('/');
  if (slug[0] === NO_PAGE) notFound();
  const data = OWN_ROUTE(key) ? null : await getPage(key);
  if (!data) {
    const onMissing = cmsRuntime().onMissing;
    if (onMissing) await onMissing(`/${key}`);
    notFound();
  }
  return <CmsPageBody data={data} />;
}
