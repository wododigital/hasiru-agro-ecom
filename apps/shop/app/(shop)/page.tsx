import Link from 'next/link';
import { CmsPageBody, getPage, pageMetadataFor } from '@ecomkit/cms/server';
import { messages } from '../../messages/en';

const h = messages.home;

async function homePage() {
  try {
    return await getPage('home');
  } catch {
    return null;
  }
}

export async function generateMetadata() {
  return pageMetadataFor(await homePage());
}

/** Home: the two-path hero (shop or wizard), then the seeded cms home blocks (rails, calculators, testimonials). */
export default async function HomePage() {
  const data = await homePage();
  return (
    <>
      <section className="mx-auto max-w-7xl px-4 py-12">
        <p className="text-sm uppercase tracking-wide">{h.hero.eyebrow}</p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl">
          {h.hero.titleBefore}<em>{h.hero.titleAccent}</em>{h.hero.titleAfter}
        </h1>
        <p className="mt-4 max-w-2xl">{h.hero.lead}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {([['/plants', h.paths.shop], ['/plan', h.paths.choose]] as const).map(([href, p]) => (
            <Link key={href} href={href} className="block rounded-xl border p-6">
              <span className="block text-xl font-semibold">{p.title}</span>
              <span className="mt-2 block">{p.body}</span>
              <span className="mt-4 inline-block font-semibold">{p.cta}</span>
            </Link>
          ))}
        </div>
      </section>
      {data ? <CmsPageBody data={data} /> : null}
    </>
  );
}
