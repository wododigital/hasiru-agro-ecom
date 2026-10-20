import Link from 'next/link';
import { getMenu } from '@ecomkit/cms/server';
import type { MenuNode } from '@ecomkit/cms';
import { messages } from '../../messages/en';

const m = messages.shell;

// Fallbacks keep the shell navigable when the cms menus are empty (fresh database).
const HEADER_FALLBACK: readonly [string, string][] = [
  ['/plants', m.nav.plants], ['/plan', m.nav.helpMeChoose], ['/farm-development', m.nav.farmDevelopment],
  ['/inputs', m.nav.inputs], ['/guides', m.nav.guides],
];
const FOOTER_FALLBACK: readonly [string, string][] = [
  ['/about', 'About'], ['/contact', 'Contact'], ['/why-choose-us', 'Why choose us'], ['/calculators/plants', 'Plant calculator'],
  ['/calculators/compost', 'Compost calculator'], ['/build-farm-with-us', 'Build a farm with us'], ['/videos', 'Videos'],
];
const POLICIES: readonly [string, string][] = [
  ['/policies/delivery', 'Delivery'], ['/policies/damage-and-replacement', 'Damage and replacement'],
  ['/policies/cancellation-and-refund', 'Cancellation and refund'], ['/policies/privacy', 'Privacy'], ['/policies/terms', 'Terms'],
];

async function menu(key: string, fallback: readonly [string, string][]): Promise<readonly [string, string][]> {
  try {
    const nodes: MenuNode[] = await getMenu(key);
    return nodes.length ? nodes.map((n) => [n.href, n.label] as [string, string]) : fallback;
  } catch {
    return fallback;
  }
}

export async function SiteHeader() {
  const items = await menu('header', HEADER_FALLBACK);
  return (
    <header className="border-b border-[var(--color-border,#e5e7eb)] bg-[var(--color-surface,#fff)]">
      <a href="#main" className="sr-only focus:not-sr-only">{m.skipToContent}</a>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/" aria-label={messages.brand.homeLabel} className="font-[family-name:var(--font-display)] text-xl">{messages.brand.name}</Link>
        <nav aria-label={m.nav.label} className="flex flex-1 flex-wrap gap-4 text-sm">
          {items.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <Link href="/search" className="text-sm">{m.notFound.search}</Link>
        <Link href="/account" className="text-sm">{m.account}</Link>
        <Link href="/cart" className="text-sm">{m.cart}</Link>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const items = await menu('footer', FOOTER_FALLBACK);
  return (
    <footer className="mt-16 border-t border-[var(--color-border,#e5e7eb)] px-4 py-10 text-sm">
      <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-3">
        <nav aria-label={m.footer.company}>
          <p className="mb-2 font-semibold">{m.footer.company}</p>
          <ul className="space-y-1">{items.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
        </nav>
        <nav aria-label={m.footer.shop}>
          <p className="mb-2 font-semibold">{m.footer.shop}</p>
          <ul className="space-y-1">{HEADER_FALLBACK.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
        </nav>
        <nav aria-label={m.footer.policies}>
          <p className="mb-2 font-semibold">{m.footer.policies}</p>
          <ul className="space-y-1">{POLICIES.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
        </nav>
      </div>
    </footer>
  );
}
