import type { ModuleId } from '@ecomkit/core/contracts';

/**
 * Modules enabled in the Hasiru Agro store. Orchestrator-owned: a module is added here after its wave merges,
 * then `pnpm modules:sync` regenerates routes, registry and schema list. Order does not matter (dependencies decide).
 */
export const modules: readonly ModuleId[] = [
  'core', 'ui', 'auth', 'admin-shell', 'media', 'catalog', 'pricing', 'discounts', 'inventory', 'search', 'seo', 'cms',
  'notifications', 'monitoring', 'analytics', 'places', 'customers', 'enquiries', 'reviews',
  'cart', 'shipping', 'truck-meter', 'checkout', 'orders', 'payments', 'flows', 'marketing', 'feeds',
  'planting', 'farm-calculators', 'planting-3d', 'ai-assistant', 'erp-sync', 'hasiru-ops-adapter',
];
