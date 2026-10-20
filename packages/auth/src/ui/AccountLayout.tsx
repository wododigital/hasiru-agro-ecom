import { Skeleton } from '@ecomkit/ui';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { authMessages } from '../messages';
import { getViewer } from '../server/viewer';
import { SignOutForm } from './SignOutForm';

export interface AccountLayoutProps {
  children: ReactNode;
  /** Page paths enabled modules declare (from the app registry); an account link shows only when its page exists. */
  pagePaths: readonly string[];
  messages?: typeof authMessages.account;
}

async function AccountNav({ pagePaths, messages: m }: { pagePaths: readonly string[]; messages: typeof authMessages.account }) {
  const viewer = await getViewer();
  if (viewer.kind !== 'customer') return null;
  const links = Object.entries(m.links).filter(([href]) => href === '/account' || pagePaths.includes(href));
  return (
    <nav aria-label={m.navLabel} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border pb-3">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className="text-sm font-semibold text-primary hover:underline" data-cta={`account-nav-${href.split('/').pop()}`}>
          {label}
        </Link>
      ))}
      <div className="ml-auto">
        <SignOutForm label={m.signOut} />
      </div>
    </nav>
  );
}

/**
 * Shell for /account/*. The nav shows only to a signed-in customer; each page still guards itself
 * (`requireCustomer()` or `requireOwner()`), so the login page renders inside the same shell.
 */
export function AccountLayout({ children, pagePaths, messages = authMessages.account }: AccountLayoutProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<Skeleton className="h-9 w-full" />}>
        <AccountNav pagePaths={pagePaths} messages={messages} />
      </Suspense>
      {/* Every account page reads the signed-in customer (request-time data); the shell owns the boundary so pages need none. */}
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>{children}</Suspense>
    </div>
  );
}
