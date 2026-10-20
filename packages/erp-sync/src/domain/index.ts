// Pure rules for ERP sync: settings, boundary schemas, retry backoff, name matching. No DB, no React.
import type { Paise } from '@ecomkit/core/contracts';
import { z } from 'zod';

export const erpSyncSettingsSchema = z.object({
  enabled: z.boolean().default(true).meta({ group: 'Sync', help: 'Off stops inventory pulls and outbox pushes. Orders and leads still queue and go out when it is back on.' }),
  pullEveryMinutes: z.number().int().min(5).max(1440).default(10).meta({ group: 'Sync', help: 'How often stock is pulled from the ERP.' }),
  autoMapMinConfidence: z.number().min(0.5).max(1).default(0.8).meta({ group: 'Mapping', help: 'Name matches at or above this score are linked automatically. Lower scores wait for an admin.' }),
  maxAttempts: z.number().int().min(1).max(50).default(10).meta({ group: 'Outbox', help: 'Failed pushes retry with backoff, then move to dead letter and raise an alert.' }),
  notConfiguredRetryMinutes: z.number().int().min(1).max(1440).default(15).meta({ group: 'Outbox', help: 'While the ERP side has no endpoint, rows stay pending and are retried this often (no attempt counted).' }),
});
export type ErpSyncSettings = z.infer<typeof erpSyncSettingsSchema>;

// ---- boundary schemas (adapter output and port payloads are validated, never trusted) ----

const isoDate = z.iso.datetime({ offset: true });
const paise = z
  .number()
  .int()
  .transform((n) => n as Paise);

export const erpInventoryItemSchema = z.object({
  erpItemId: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(200).nullable(),
  name: z.string().trim().min(1).max(500),
  variety: z.string().trim().max(500).nullable(),
  available: z.number().finite().transform((n) => Math.max(0, Math.floor(n))),
  readyInDays: z.number().int().min(0).max(3650).nullable(),
  costPaise: paise.nullable(),
  updatedAt: isoDate,
});
export const erpInventoryPageSchema = z.object({ items: z.array(erpInventoryItemSchema).max(5000), nextCursor: z.string().max(500).nullable() });
export type ErpInventoryItemParsed = z.infer<typeof erpInventoryItemSchema>;

export const erpOrderPayloadSchema = z.object({
  ecomOrderNumber: z.string().min(1).max(64),
  placedAt: isoDate,
  customer: z.object({ name: z.string().max(200), phone: z.string().max(20), email: z.string().max(320).nullable(), gstin: z.string().max(15).nullable() }),
  deliver: z.object({ method: z.string().max(40), slotDate: z.string().max(10).nullable(), district: z.string().max(100).nullable(), address: z.string().max(1000) }),
  lines: z
    .array(z.object({ erpItemId: z.string().max(200).nullable(), sku: z.string().max(200), name: z.string().max(500), qty: z.number().int().positive(), unitPaise: paise, lineTotalPaise: paise }))
    .min(1)
    .max(500),
  totals: z.object({ subtotalPaise: paise, discountPaise: paise, shippingPaise: paise, taxPaise: paise, totalPaise: paise, paidPaise: paise }),
  status: z.string().max(40),
});

export const erpLeadPayloadSchema = z.object({
  leadId: z.uuid(),
  source: z.enum(['wizard', 'notify_me', 'enquiry', 'chat', 'checkout']),
  name: z.string().max(200).nullable(),
  phone: z.string().min(1).max(20),
  email: z.string().max(320).nullable(),
  district: z.string().max(100).nullable(),
  landAcres: z.number().nonnegative().nullable(),
  purpose: z.string().max(500).nullable(),
  notes: z.string().max(4000).nullable(),
  createdAt: isoDate,
});

export const pushOrderResultSchema = z.object({ opsOrderId: z.string().min(1).max(200), invoiceNumber: z.string().max(100).nullable() });
export const pushLeadResultSchema = z.object({ externalId: z.string().max(200).nullable() });

/** Status callback body (ops -> us). Only fulfilment states the ERP owns. */
export const OPS_ORDER_STATUSES = ['packed', 'dispatched', 'delivered'] as const;
export const statusCallbackSchema = z.object({ ecomOrderNumber: z.string().min(1).max(64), status: z.enum(OPS_ORDER_STATUSES), at: isoDate.optional() });
export type StatusCallback = z.infer<typeof statusCallbackSchema>;

// ---- retry backoff ----

/** Delay before attempt n+1 after n failures: 30 s doubling, capped at 1 h. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

// ---- name matching ----

/** Lower case, punctuation to spaces, collapsed. Bracketed text kept (it usually carries the variety). */
export function normaliseName(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen-Dice over character bigrams of the normalised strings, 0..1, rounded to 2 places. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const x = bigrams(a);
  const y = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of x) {
    overlap += Math.min(n, y.get(g) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return Math.round(((2 * overlap) / total) * 100) / 100;
}

export interface MatchCandidate {
  variantId: string;
  sku: string | null;
  name: string;
  variety: string | null;
}
export interface MatchItem {
  erpItemId: string;
  sku: string | null;
  name: string;
  variety: string | null;
}
export interface MatchProposal {
  erpItemId: string;
  variantId: string;
  confidence: number;
  via: 'sku' | 'name';
}

/**
 * Best variant for each ERP item, one to one. Exact SKU (case-insensitive) scores 1; otherwise (name, variety) similarity.
 * Greedy by score so the strongest pairs win; ties break on ids for determinism.
 * ponytail: O(items x candidates) scan, fine for a few thousand SKUs; index by bigram if a catalogue grows past that.
 */
export function proposeMatches(items: readonly MatchItem[], candidates: readonly MatchCandidate[]): MatchProposal[] {
  const bySku = new Map(candidates.filter((c) => c.sku).map((c) => [c.sku!.trim().toLowerCase(), c]));
  const keys = candidates.map((c) => ({ c, key: normaliseName(c.name, c.variety) }));
  const pairs: MatchProposal[] = [];
  for (const item of items) {
    const skuHit = item.sku ? bySku.get(item.sku.trim().toLowerCase()) : undefined;
    if (skuHit) {
      pairs.push({ erpItemId: item.erpItemId, variantId: skuHit.variantId, confidence: 1, via: 'sku' });
      continue;
    }
    const key = normaliseName(item.name, item.variety);
    for (const { c, key: ck } of keys) {
      const score = similarity(key, ck);
      if (score > 0) pairs.push({ erpItemId: item.erpItemId, variantId: c.variantId, confidence: score, via: 'name' });
    }
  }
  pairs.sort((a, b) => b.confidence - a.confidence || a.erpItemId.localeCompare(b.erpItemId) || a.variantId.localeCompare(b.variantId));
  const usedItems = new Set<string>();
  const usedVariants = new Set<string>();
  const out: MatchProposal[] = [];
  for (const p of pairs) {
    if (usedItems.has(p.erpItemId) || usedVariants.has(p.variantId)) continue;
    usedItems.add(p.erpItemId);
    usedVariants.add(p.variantId);
    out.push(p);
  }
  return out;
}

/**
 * One RFC 4180 CSV line. Text cells starting with = + - @ get a leading ' so spreadsheets do not run them as formulas.
 * ponytail: catalog has its own export path (SheetJS); fold both into one core csv helper at the audit.
 */
export function csvLine(cells: readonly (string | number | null | undefined)[]): string {
  return cells
    .map((c) => {
      if (c == null) return '';
      if (typeof c === 'number') return String(c);
      const s = /^[=+\-@\t\r]/.test(c) ? `'${c}` : c;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}
