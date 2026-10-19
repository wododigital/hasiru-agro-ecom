import type { Paise } from './common';
import type { LeadSource } from './events';
import type { SettingsActionResult } from './extensions';

export interface ErpInventoryItem {
  erpItemId: string;
  sku: string | null;
  name: string;
  variety: string | null;
  available: number;
  readyInDays: number | null;
  costPaise: Paise | null;
  updatedAt: string;
}

export interface ErpOrderPayload {
  ecomOrderNumber: string;
  placedAt: string;
  customer: { name: string; phone: string; email: string | null; gstin: string | null };
  deliver: { method: string; slotDate: string | null; district: string | null; address: string };
  lines: readonly {
    erpItemId: string | null;
    sku: string;
    name: string;
    qty: number;
    unitPaise: Paise;
    lineTotalPaise: Paise;
  }[];
  totals: {
    subtotalPaise: Paise;
    discountPaise: Paise;
    shippingPaise: Paise;
    taxPaise: Paise;
    totalPaise: Paise;
    paidPaise: Paise;
  };
  status: string;
}

export interface ErpLeadPayload {
  leadId: string;
  source: LeadSource;
  name: string | null;
  phone: string;
  email: string | null;
  district: string | null;
  landAcres: number | null;
  purpose: string | null;
  notes: string | null;
  createdAt: string;
}

/** Transports: mock, pg (read-only role, inventory in), ops-api (orders and leads out). */
export interface ErpAdapter {
  id: string;
  pullInventory(input: { since: string | null; cursor: string | null }): Promise<{ items: ErpInventoryItem[]; nextCursor: string | null }>;
  /** Idempotent on ecomOrderNumber. */
  pushOrder(payload: ErpOrderPayload): Promise<{ opsOrderId: string; invoiceNumber: string | null }>;
  pushLead(payload: ErpLeadPayload): Promise<{ externalId: string | null }>;
  testConnection(): Promise<SettingsActionResult>;
}
