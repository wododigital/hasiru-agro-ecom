import type { ComponentType } from 'react';
import type { DateRange, Lazy, Logger } from './common';
import type { Permission } from './auth';
import type { TotalsBreakdown } from './totals';

// ---- settings-action -------------------------------------------------------
export interface SettingsActionResult {
  ok: boolean;
  /** Short human message shown as a toast on the settings page. */
  message: string;
  /** For `oauth-redirect` actions: where to send the admin. */
  redirectUrl?: string;
  detail?: Readonly<Record<string, unknown>>;
}
export interface SettingsAction {
  id: string;
  label: string;
  kind: 'server-action' | 'oauth-redirect' | 'test-connection';
  /** Defaults to settings.write. */
  permission?: Permission;
  run: Lazy<(ctx: { moduleId: string; actorId: string }) => Promise<SettingsActionResult>>;
}

// ---- cart-block ------------------------------------------------------------
export interface CartLineOrigin {
  source: 'shop' | 'planting' | 'calculator' | 'assistant' | 'restore';
  modelSlug?: string;
  /** Overrides the variant weight (e.g. Miyawaki saplings 0.8 kg). */
  weightKg?: number;
}
export interface CartBlockLine {
  lineId: string;
  kind: 'product' | 'package';
  productId: string;
  variantId: string;
  qty: number;
  /** Per unit: origin.weightKg when set, else catalog_variant.weight_kg. */
  weightKg: number;
  packageId: string | null;
  origin: CartLineOrigin | null;
}
export interface CartBlockProps {
  cartId: string;
  lines: readonly CartBlockLine[];
  totals: TotalsBreakdown | null;
  selectedMethodId: string | null;
}
export interface CartBlock {
  id: string;
  order: number;
  placement: 'cart' | 'checkout-summary' | 'both';
  component: Lazy<ComponentType<CartBlockProps>>;
}

// ---- pdp-section -----------------------------------------------------------
export interface PdpSectionProps {
  productId: string;
  slug: string;
}
export interface PdpSection {
  id: string;
  order: number;
  slot: 'main' | 'aside' | 'below';
  component: Lazy<ComponentType<PdpSectionProps>>;
}

// ---- card-chip -------------------------------------------------------------
export interface CardChip {
  id: string;
  /** Already-resolved copy from the providing module's messages. */
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'accent';
}
/** Batched so a 24-card grid costs one call per source, not one per card. */
export interface ProductCardChipSource {
  id: string;
  order: number;
  resolve: Lazy<(productIds: readonly string[]) => Promise<Record<string, CardChip[]>>>;
}

// ---- checkout-section ------------------------------------------------------
export interface CheckoutSectionProps {
  checkoutSessionId: string;
  cartId: string;
}
export interface CheckoutSection {
  id: string;
  order: number;
  slot: 'contact' | 'delivery' | 'payment' | 'summary';
  component: Lazy<ComponentType<CheckoutSectionProps>>;
}

// ---- product-form-tab ------------------------------------------------------
export interface ProductFormTabProps {
  /** Null while creating a product. */
  productId: string | null;
}
export interface ProductFormTab {
  id: string;
  label: string;
  order: number;
  permission?: Permission;
  component: Lazy<ComponentType<ProductFormTabProps>>;
}

// ---- dashboard-widget ------------------------------------------------------
export interface DashboardWidget {
  id: string;
  title: string;
  order: number;
  size: 'sm' | 'md' | 'lg' | 'full';
  permission?: Permission;
  /** `compare` is the comparison range picked in the admin range bar (null or absent when none). */
  component: Lazy<ComponentType<{ range: DateRange; compare?: DateRange | null }>>;
}

// ---- report ----------------------------------------------------------------
export interface Report {
  id: string;
  title: string;
  group: string;
  permission: Permission;
  component: Lazy<ComponentType<{ range: DateRange; compare?: DateRange | null }>>;
  csv?: Lazy<(range: DateRange) => Promise<{ filename: string; rows: string[][] }>>;
}

// ---- admin-todo ------------------------------------------------------------
/** Home "Things to do": a count of items needing action, linking to the filtered admin index (shown above zero only). */
export interface AdminTodo {
  id: string;
  /** Plural noun phrase after the count, e.g. "orders to dispatch". */
  label: string;
  /** The filtered index, e.g. /admin/orders?view=unfulfilled. */
  href: string;
  order: number;
  permission: Permission;
  count: Lazy<() => Promise<number>>;
}

// ---- health-check ----------------------------------------------------------
export interface HealthResult {
  status: 'ok' | 'degraded' | 'down' | 'not_configured';
  detail?: string;
  latencyMs?: number;
}
export interface HealthCheck {
  id: string;
  label: string;
  /** Critical checks raise critical alerts when down. */
  critical: boolean;
  /** Included in /api/health/ready. */
  readiness: boolean;
  run: Lazy<() => Promise<HealthResult>>;
}

// ---- sitemap-source --------------------------------------------------------
export interface SitemapEntry {
  /** Path on the canonical host. Only indexable URLs that return 200. */
  path: string;
  lastModified?: string;
  changeFrequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority?: number;
}
export interface SitemapSource {
  /** File name under /sitemap/<name>.xml (products, collections, pages, districts, guides). */
  name: string;
  entries: Lazy<() => Promise<SitemapEntry[]>>;
}

// ---- seed-hook -------------------------------------------------------------
export interface SeedContext {
  /** Absolute path of data/seed. */
  seedDir: string;
  /** Absolute path of data/media. */
  mediaDir: string;
  dryRun: boolean;
  log: Logger;
}
export interface SeedResult {
  inserted: number;
  updated: number;
  skipped: number;
  notes?: readonly string[];
}
/** Runs in module dependency order, then by `order`. Must be idempotent: a second run changes zero rows. */
export interface SeedHook {
  id: string;
  order: number;
  run: Lazy<(ctx: SeedContext) => Promise<SeedResult>>;
}
