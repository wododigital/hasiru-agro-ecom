import { notFound } from 'next/navigation';
import { POLICY_PREFIX } from '../domain';
import { CmsPageBody, cmsRuntime, getPage, NO_PAGE, pageMetadataFor, publishedPages } from '../server';

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    const list = (await publishedPages()).filter((p) => p.slug.startsWith(POLICY_PREFIX)).map((p) => ({ slug: p.slug.slice(POLICY_PREFIX.length) }));
    return list.length ? list : [{ slug: NO_PAGE }];
  } catch {
    return [{ slug: NO_PAGE }];
  }
}

export async function generateMetadata({ params }: Props) {
  return pageMetadataFor(await getPage(`${POLICY_PREFIX}${(await params).slug}`));
}

/** /policies/<slug>: a published policy page (drafts 404 until the store owner publishes the wording). */
export default async function PolicyPage({ params }: Props) {
  const { slug } = await params;
  const data = slug === NO_PAGE ? null : await getPage(`${POLICY_PREFIX}${slug}`);
  if (!data) notFound();
  return <CmsPageBody data={data} trail={[{ label: cmsRuntime().messages.breadcrumbs.policies }]} />;
}
