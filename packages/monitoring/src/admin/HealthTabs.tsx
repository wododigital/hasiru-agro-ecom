import { cn } from '@ecomkit/ui';
import Link from 'next/link';

const TABS = [
  { href: '/admin/health', label: 'Overview' },
  { href: '/admin/health/alerts', label: 'Alerts' },
  { href: '/admin/health/errors', label: 'Errors' },
  { href: '/admin/health/jobs', label: 'Jobs' },
  { href: '/admin/health/logs', label: 'Logs' },
] as const;

/** Sub navigation shared by the Health screens (one nav entry in the sidebar). */
export function HealthTabs({ active, title }: { active: (typeof TABS)[number]['href']; title: string }) {
  return (
    <header className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold text-text">{title}</h1>
      <nav aria-label="Health sections" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.href === active ? 'page' : undefined}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm', t.href === active ? 'border-primary font-semibold text-text' : 'border-transparent text-muted hover:text-text')}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
