import Link from 'next/link';
import { copy } from '../../messages';

export default function Home() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold">{copy.brand}</h1>
      <p className="text-muted">{copy.tagline}</p>
      <Link href="/plants" className="inline-block rounded-md bg-primary px-4 py-2 text-primary-fg">{copy.browse}</Link>
    </section>
  );
}
