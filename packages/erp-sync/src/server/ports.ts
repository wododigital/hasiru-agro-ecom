import type { ErpAdapter, ErpLeadPayload, ErpOrderPayload } from '@ecomkit/core/contracts';
import type { StatusCallback } from '../domain';
import type { MatchCandidate } from '../domain';

/**
 * What erp-sync needs from other modules. Orders, customers and catalog are optional, and the adapter comes from
 * whichever ERP adapter module the store enables, so the host binds them at boot (worker and web):
 *
 *   configureErpSync({
 *     adapter: () => import('@ecomkit/hasiru-ops-adapter/server').then((m) => m.opsAdapter()),
 *     orderPayload: orders.erpOrderPayload, applyOrderStatus: orders.applyErpStatus,
 *     leadPayload: customers.leadForErp, onPushed: ..., variantCandidates: catalog.variantsForErp,
 *   })
 *
 * Every port is optional: without `adapter` nothing is pulled or pushed (rows wait as pending); without
 * `orderPayload` order rows wait; without `variantCandidates` auto-mapping falls back to inventory SKUs.
 */
export interface ErpSyncPorts {
  /** Resolved per run so a settings change (transport, keys) applies on the next run. Null = not configured. */
  adapter: (() => Promise<ErpAdapter | null>) | null;
  orderPayload: ((orderId: string) => Promise<ErpOrderPayload | null>) | null;
  leadPayload: ((leadId: string) => Promise<ErpLeadPayload | null>) | null;
  /** Called after a successful push (orders store the ops order id, customers stamp erp_pushed_at). */
  onPushed: ((input: { kind: 'order' | 'lead'; refId: string; externalRef: string | null; invoiceNumber: string | null }) => Promise<void>) | null;
  /** ERP status callback -> order transition. Returns false when the order number is unknown. */
  applyOrderStatus: ((input: StatusCallback) => Promise<boolean>) | null;
  /** Catalogue variants with names for (name, variety) matching. */
  variantCandidates: (() => Promise<MatchCandidate[]>) | null;
}

// On globalThis: instrumentation (boot) and route bundles are separate module instances in Next.
const ports: ErpSyncPorts = ((globalThis as Record<symbol, ErpSyncPorts | undefined>)[Symbol.for('ecomkit.erp-sync.ports')] ??= { adapter: null, orderPayload: null, leadPayload: null, onPushed: null, applyOrderStatus: null, variantCandidates: null });

export function configureErpSync(next: Partial<ErpSyncPorts>): void {
  Object.assign(ports, next);
}

export const getPorts = (): Readonly<ErpSyncPorts> => ports;

export async function resolveAdapter(): Promise<ErpAdapter | null> {
  return ports.adapter ? ports.adapter() : null;
}
