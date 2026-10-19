import { Button, Input, buttonVariants } from '@ecomkit/ui';
import Link from 'next/link';
import type { SeoMessages } from '../messages';

export interface NotFoundViewProps {
  messages: SeoMessages['notFound'];
  /** Site search page; the form is a plain GET so it works without JS. */
  searchPath: string | null;
  links: readonly { label: string; href: string }[];
}

/** 404 body: says so, offers search and a few starting points. */
export function NotFoundView({ messages: m, searchPath, links }: NotFoundViewProps) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16">
      <h1 className="font-display text-4xl text-primary">{m.title}</h1>
      <p className="text-lg text-muted">{m.body}</p>
      {searchPath ? (
        <form action={searchPath} method="get" role="search" className="flex gap-2">
          <label htmlFor="nf-q" className="sr-only">
            {m.searchLabel}
          </label>
          <Input id="nf-q" name="q" type="search" placeholder={m.searchPlaceholder} className="flex-1" />
          <Button type="submit" data-cta="not-found-search">
            {m.searchButton}
          </Button>
        </form>
      ) : null}
      {links.length ? (
        <nav aria-labelledby="nf-links" className="flex flex-col gap-3">
          <h2 id="nf-links" className="text-lg font-semibold text-primary">
            {m.linksHeading}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={buttonVariants({ variant: 'subtle', size: 'sm' })} data-cta="not-found-link">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <Link href="/" className={buttonVariants({ variant: 'link' })} data-cta="not-found-home">
        {m.home}
      </Link>
    </main>
  );
}
