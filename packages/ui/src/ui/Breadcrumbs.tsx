import Link from 'next/link';
import { cn } from '../cn';
import { uiMessages } from '../messages';

export interface Crumb {
  label: string;
  /** Omit on the current page. */
  href?: string;
}

/** Visual trail only; BreadcrumbList JSON-LD comes from the seo module. */
export function Breadcrumbs({ items, label = uiMessages.breadcrumbs.label, className }: { items: readonly Crumb[]; label?: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn('text-sm text-muted', className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => (
          <li key={`${i}-${c.label}`} className="flex items-center gap-1.5">
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {i === items.length - 1 ? (
              <span aria-current="page" className="font-medium text-text">
                {c.label}
              </span>
            ) : c.href ? (
              <Link href={c.href} className="hover:text-primary hover:underline">
                {c.label}
              </Link>
            ) : (
              <span>{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
