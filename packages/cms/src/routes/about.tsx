import { notFound } from 'next/navigation';
import { CmsPageBody, getPage, pageMetadataFor } from '../server';

export async function generateMetadata() {
  return pageMetadataFor(await getPage('about'));
}

/** /about: the cms page `about`, with LocalBusiness JSON-LD. */
export default async function AboutPage() {
  const data = await getPage('about');
  if (!data) notFound();
  return <CmsPageBody data={data} localBusiness />;
}
