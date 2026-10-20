import type { ComponentType } from 'react';
import type { ZodObject, ZodRawShape } from 'zod';
import type { Permission } from './auth';
import type { Lazy, ModuleId } from './common';
import type { EventHandler, EventName } from './events';
import type {
  CartBlock,
  CheckoutSection,
  DashboardWidget,
  HealthCheck,
  PdpSection,
  ProductCardChipSource,
  ProductFormTab,
  Report,
  SeedHook,
  SettingsAction,
  SitemapSource,
} from './extensions';
import type { JobDef, ScheduleDef } from './jobs';
import type { ServiceMap } from './services';

/** Admin nav order bands. A module's item order is band + 0..99. */
export const NAV_BANDS = {
  home: 0,
  orders: 100,
  products: 200,
  customers: 300,
  marketing: 400,
  content: 500,
  analytics: 600,
  enquiries: 700,
  health: 800,
  settings: 900,
} as const;
export type NavBand = keyof typeof NAV_BANDS;

export type RouteExport =
  | 'default'
  | 'generateMetadata'
  | 'generateStaticParams'
  | 'generateViewport'
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/**
 * A route the module contributes. `modules:sync` writes a stub that re-exports `exports`
 * from `@ecomkit/<id>/<module>`:
 * - kind 'page', path '/admin/...': app/(admin)/admin/.../page.tsx
 * - kind 'page', other paths:       app/(shop)/<path>/page.tsx
 * - kind 'route':                    app/<path>/route.ts
 * Segment config values are written as literals because Next reads them statically.
 */
export interface RouteDef {
  path: string;
  module: string;
  kind: 'page' | 'route';
  exports: readonly RouteExport[];
  /** Scalars, or a string map for object-valued config such as `unstable_paramMatching: { slug: 'blocking' }`. */
  segmentConfig?: Readonly<Record<string, string | number | boolean | Readonly<Record<string, string>>>>;
}

export interface AdminNavItem {
  /** Admin copy (admin UI is English-only and exempt from the messages rule). */
  label: string;
  href: string;
  /** lucide-react icon name in kebab-case. */
  icon: string;
  /** NAV_BANDS value + 0..99. */
  order: number;
  permission?: Permission;
}

export interface ModuleSettings<Shape extends ZodRawShape = ZodRawShape> {
  /** `.meta({ secret: true })` marks encrypted fields; `.meta({ group, help, placeholder })` drive the form. */
  schema: ZodObject<Shape>;
  actions?: readonly SettingsAction[];
  /** Server component rendered under the generated form on /admin/settings/<id>. */
  customPanel?: Lazy<ComponentType<{ moduleId: string }>>;
}

export type EventSubscriptions = { readonly [E in EventName]?: Lazy<EventHandler<E>> };
export type ServiceProviders = { readonly [K in keyof ServiceMap]?: Lazy<ServiceMap[K]> };

/**
 * The single description of a module. Lives at `packages/<mod>/src/manifest.ts`
 * (default export via `defineModule`). Keep it light: zod, constants and Lazy imports only,
 * so codegen and the worker can load it without pulling UI or server code.
 */
export interface ModuleManifest {
  id: ModuleId;
  /** Hard dependencies; enabling this module without them fails modules:sync. */
  dependsOn: readonly ModuleId[];
  /** Soft dependencies; features degrade when absent (`registry.has(id)` / `registry.service(key)`). */
  optional?: readonly ModuleId[];
  /** Present when the module ships `src/schema.ts` (exported as `@ecomkit/<id>/schema`). */
  schema?: Lazy<Record<string, unknown>>;
  routes?: readonly RouteDef[];
  /** Emitted only when the app config has `mocks: true`. Paths must start with /api/_mock/. */
  mockRoutes?: readonly RouteDef[];
  admin?: {
    nav?: readonly AdminNavItem[];
    /** Paths must start with /admin. Settings pages are never listed: admin-shell renders /admin/settings/<id>. */
    pages?: readonly RouteDef[];
  };
  settings?: ModuleSettings;
  productFormTabs?: readonly ProductFormTab[];
  permissions?: readonly Permission[];
  /** Job names are `<id>.<name>`. */
  jobs?: Readonly<Record<string, JobDef<never>>>;
  schedules?: readonly ScheduleDef[];
  emits?: readonly EventName[];
  on?: EventSubscriptions;
  cacheTags?: readonly string[];
  provides?: ServiceProviders;
  cartBlocks?: readonly CartBlock[];
  pdpSections?: readonly PdpSection[];
  productCardChips?: readonly ProductCardChipSource[];
  checkoutSections?: readonly CheckoutSection[];
  dashboardWidgets?: readonly DashboardWidget[];
  reports?: readonly Report[];
  healthChecks?: readonly HealthCheck[];
  sitemapSources?: readonly SitemapSource[];
  seedHooks?: readonly SeedHook[];
}

/** `apps/<app>/modules.config.<env>.ts` default export. */
export interface AppConfig {
  app: string;
  modules: readonly ModuleId[];
  /** true in dev and test configs; false in prod so mock route stubs never exist in a production build. */
  mocks: boolean;
}
