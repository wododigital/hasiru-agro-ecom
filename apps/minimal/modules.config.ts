import type { ModuleId } from '@ecomkit/core/contracts';

/** Enabled as each module lands (orchestrator-owned). */
export const modules: readonly ModuleId[] = [
  'core', 'ui', 'auth', 'media', 'catalog', 'pricing', 'inventory', 'cart', 'checkout', 'payments', 'orders', 'customers', 'seo',
];

/** The pick-and-choose proof set (addendum 1): generic modules only, no Hasiru-specific ones. */
export const targetModules: readonly ModuleId[] = [
  'core', 'ui', 'auth', 'media', 'catalog', 'pricing', 'inventory', 'cart', 'checkout', 'payments', 'orders', 'customers', 'seo',
];
