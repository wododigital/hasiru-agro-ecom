import type { Paise } from '@ecomkit/core/contracts';

/** A person a flow may message. Read fresh from the owning module at each step; never stored by flows. */
export interface Contact {
  customerId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface CartSnapshot {
  status: 'active' | 'converted' | 'abandoned' | 'merged';
  /** The customer, else the checkout session contact; null when nobody is known. */
  contact: Contact | null;
  totalPaise: Paise | null;
  itemCount: number;
}

export interface OrderSummary {
  number: string;
  status: string;
  isTest: boolean;
  contact: Contact;
  totalPaise: Paise;
  /** Display text (IST), e.g. "Sat 24 Oct"; null when not known yet. */
  deliveryDate: string | null;
  slotWindow: string | null;
  /** Absolute link to the order page (account or guest token page). */
  link: string;
}

/**
 * What flows needs from modules it does not depend on (cart, orders, discounts, catalog) and from customers'
 * leads (no system read is exported). The host binds them at boot with `configureFlows`; an unbound port makes
 * the flows that need it start no runs (`subject_missing`), and the rest keep working.
 */
export interface FlowPorts {
  carts: {
    snapshot(cartId: string, checkoutSessionId: string | null): Promise<CartSnapshot | null>;
    /**
     * The cart module's restore link for reminder messages (path or absolute URL; null when the cart is gone).
     * The cart owns the link: it is signed, single use and stays valid 14 days (`days`); `couponCode` is the run's
     * single-use code, applied by the cart when the link is opened.
     */
    restoreLink(cartId: string, options: { couponCode: string | null; days: number }): Promise<string | null>;
  } | null;
  orders: {
    summary(orderId: string): Promise<OrderSummary | null>;
    /** True when the contact placed an order at or after `since`. */
    hasOrderSince(contact: Contact, since: Date): Promise<boolean>;
  } | null;
  leads: { get(leadId: string): Promise<(Contact & { link: string | null }) | null> } | null;
  products: { label(productId: string): Promise<{ name: string; href: string } | null> } | null;
  discounts: { createSingleUseCode(options: { ruleId: string; phone: string; expiresAt: Date | null }): Promise<string> } | null;
}

// On globalThis: instrumentation (boot) and route bundles are separate module instances in Next.
const ports: FlowPorts = ((globalThis as Record<symbol, FlowPorts | undefined>)[Symbol.for('ecomkit.flows.ports')] ??= { carts: null, orders: null, leads: null, products: null, discounts: null });

export function configureFlows(next: Partial<FlowPorts>): void {
  Object.assign(ports, next);
}
export const flowPorts = (): Readonly<FlowPorts> => ports;
