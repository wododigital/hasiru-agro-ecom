import { NAV_BANDS, type AdminNavItem, type Permission, type Viewer } from '@ecomkit/core/contracts';

/** Paths under /admin that render for signed-out visitors (the staff sign-in page). Everything else is staff only. */
export const PUBLIC_ADMIN_PATHS = ['/admin/login'] as const;

export type AdminGate = 'shell' | 'bare' | 'not-found';

/**
 * What the admin layout does for a viewer. Staff get the shell. Anyone else gets a 404, except on the public
 * sign-in path. When the path is unknown (no `x-pathname` header) the layout renders the page bare and leaves
 * the decision to the page, which guards itself as every admin page must.
 */
export function adminGate(viewer: Viewer, pathname: string | null): AdminGate {
  if (viewer.kind === 'staff') return 'shell';
  if (pathname === null) return 'bare';
  const path = pathname.replace(/\/+$/, '') || '/';
  return PUBLIC_ADMIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`)) ? 'bare' : 'not-found';
}

const BAND_LABELS: Record<keyof typeof NAV_BANDS, string> = {
  home: 'Home',
  orders: 'Orders',
  products: 'Products',
  customers: 'Customers',
  marketing: 'Marketing',
  content: 'Content',
  analytics: 'Analytics',
  enquiries: 'Enquiries',
  health: 'Health',
  settings: 'Settings',
};

export interface NavLink {
  label: string;
  href: string;
  icon: string;
}
export interface NavSection {
  band: keyof typeof NAV_BANDS;
  label: string;
  items: NavLink[];
}

/** Band of an order value: the highest band start that is <= order. */
export function bandOf(order: number): keyof typeof NAV_BANDS {
  let best: keyof typeof NAV_BANDS = 'home';
  for (const [band, start] of Object.entries(NAV_BANDS) as [keyof typeof NAV_BANDS, number][]) if (order >= start && start >= NAV_BANDS[best]) best = band;
  return best;
}

/**
 * Sidebar sections from the registry nav (already sorted by order, then label): items the viewer may not open are
 * dropped, then items are grouped by band. Empty bands disappear, so a store without a module shows no gap.
 */
export function navSections(nav: readonly AdminNavItem[], permissions: readonly Permission[]): NavSection[] {
  const sections: NavSection[] = [];
  for (const item of nav) {
    if (item.permission && !permissions.includes(item.permission)) continue;
    const band = bandOf(item.order);
    let section = sections.at(-1);
    if (!section || section.band !== band) sections.push((section = { band, label: BAND_LABELS[band], items: [] }));
    section.items.push({ label: item.label, href: item.href, icon: item.icon });
  }
  return sections;
}

/** Longest nav href that prefixes the pathname, so /admin/orders/123 lights up Orders and /admin only lights Home. */
export function activeHref(hrefs: readonly string[], pathname: string): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const hit = pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`));
    if (hit && (!best || href.length > best.length)) best = href;
  }
  return best;
}
