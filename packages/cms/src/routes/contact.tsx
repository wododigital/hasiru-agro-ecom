import { notFound } from 'next/navigation';
import { CmsPageBody, getPage, pageMetadataFor } from '../server';

export async function generateMetadata() {
  return pageMetadataFor(await getPage('contact'));
}

/** /contact: the cms page `contact`, with LocalBusiness JSON-LD (address, hours, phone from the site identity). */
export default async function ContactPage() {
  const data = await getPage('contact');
  if (!data) notFound();
  return <CmsPageBody data={data} localBusiness />;
}
