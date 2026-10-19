/** Integer paise. The only money type; never a float, never rupees. Helpers live in `@ecomkit/core/money`. */
export type Paise = number & { readonly __brand: 'Paise' };

/** A lazily imported value. Manifests reference code only through these so they stay cheap to load (codegen, worker, admin). */
export type Lazy<T> = () => Promise<T>;

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/** ISO date range (YYYY-MM-DD, inclusive), interpreted in Asia/Kolkata. */
export interface DateRange {
  from: string;
  to: string;
}

export type Locale = 'en-IN' | 'kn-IN';

export const MODULE_IDS = [
  'core',
  'ui',
  'auth',
  'admin-shell',
  'media',
  'catalog',
  'pricing',
  'search',
  'inventory',
  'cart',
  'checkout',
  'payments',
  'orders',
  'customers',
  'discounts',
  'shipping',
  'reviews',
  'notifications',
  'flows',
  'analytics',
  'monitoring',
  'marketing',
  'feeds',
  'seo',
  'cms',
  'ai-assistant',
  'erp-sync',
  'enquiries',
  'planting',
  'planting-3d',
  'farm-calculators',
  'truck-meter',
  'places',
  'hasiru-ops-adapter',
] as const;
export type KnownModuleId = (typeof MODULE_IDS)[number];
/** Known ids autocomplete; a new store may add its own module ids (kebab-case). */
export type ModuleId = KnownModuleId | (string & {});
