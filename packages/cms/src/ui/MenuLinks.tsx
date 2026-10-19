import { cn } from '@ecomkit/ui';
import type { MenuNode } from '../domain';
import { SmartLink } from './blocks';

/** A cms menu as nested lists (footer columns, header links). Styling comes from the host through className. */
export function MenuLinks({ items, className, itemClassName, label }: { items: readonly MenuNode[]; className?: string; itemClassName?: string; label?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <SmartLink href={item.href} className={cn('hover:underline', itemClassName)} cta="cms-menu-link">
              {item.label}
            </SmartLink>
            {item.children.length ? (
              <ul className="mt-2 flex flex-col gap-1 pl-3">
                {item.children.map((c) => (
                  <li key={c.id}>
                    <SmartLink href={c.href} className={cn('text-sm hover:underline', itemClassName)} cta="cms-menu-link">
                      {c.label}
                    </SmartLink>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}
