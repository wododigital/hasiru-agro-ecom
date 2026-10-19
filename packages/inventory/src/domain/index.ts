// Pure inventory rules shared by server, admin and storefront. No React, no Next, no database.
import type { Availability, StockInfo } from '@ecomkit/core/contracts';
import { z } from 'zod';

export type { Availability, StockInfo } from '@ecomkit/core/contracts';

export interface LevelNumbers {
  variantId: string;
  onHand: number;
  reserved: number;
  readyInDays: number | null;
  lowStockThreshold: number | null;
}

/**
 * Availability from a level row: sellable = on_hand - reserved (floored at 0).
 * Sellable stock is in stock; none but a ready date is preorder; otherwise out of stock.
 * `fallbackThreshold` (settings) applies when the variant has no threshold of its own.
 */
export function deriveStock(level: LevelNumbers, fallbackThreshold: number | null = null): StockInfo {
  const available = Math.max(0, level.onHand - level.reserved);
  const threshold = level.lowStockThreshold ?? fallbackThreshold;
  const availability: Availability = available > 0 ? 'in_stock' : level.readyInDays != null ? 'preorder' : 'out_of_stock';
  return {
    variantId: level.variantId,
    available,
    onHand: level.onHand,
    reserved: level.reserved,
    availability,
    readyInDays: level.readyInDays,
    lowStock: threshold != null && available > 0 && available <= threshold,
  };
}

/** True only when a change takes sellable stock to or below the threshold from above it, so one dip raises one event. */
export function crossedLowStock(before: number, after: number, threshold: number | null): boolean {
  return threshold != null && after > 0 && after <= threshold && before > threshold;
}

const qty = z.number().int().min(1).max(100_000);
const count = z.number().int().min(0).max(10_000_000);
const days = z.number().int().min(0).max(3650);

export const reserveLinesSchema = z
  .array(z.object({ variantId: z.uuid(), qty }))
  .min(1)
  .max(200);

export const reserveOptionsSchema = z.object({
  ttlSec: z.number().int().min(30).max(7 * 86_400),
  reference: z.string().trim().min(1).max(200),
});

/** Admin set: a manual override of the counted stock (A26). */
export const setLevelSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  sku: z.string().trim().max(100).nullish(),
  onHand: count,
  readyInDays: days.nullish(),
  lowStockThreshold: count.nullish(),
  note: z.string().trim().max(500).nullish(),
});
export type SetLevelInput = z.infer<typeof setLevelSchema>;

/** Relative change (+/-), e.g. damage write-off or a cancelled order restocked. */
export const adjustSchema = z.object({
  variantId: z.uuid(),
  delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'delta must not be zero'),
  reason: z.enum(['adjust', 'cancel']).default('adjust'),
  ref: z.string().trim().max(200).nullish(),
});
export type AdjustInput = z.input<typeof adjustSchema>;

/** Settings fields that do not override the counted stock. */
export const levelSettingsSchema = z.object({
  variantId: z.uuid(),
  readyInDays: days.nullable(),
  lowStockThreshold: count.nullable(),
});

export const erpItemSchema = z.object({
  variantId: z.uuid(),
  onHand: z.number().int().transform((n) => Math.max(0, n)),
  readyInDays: days.nullish(),
  updatedAt: z.coerce.date().optional(),
});
export type ErpItem = z.input<typeof erpItemSchema>;

export const seedLevelSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  sku: z.string().trim().max(100).nullish(),
  onHand: count,
  readyInDays: days.nullish(),
  lowStockThreshold: count.nullish(),
});
export type SeedLevel = z.input<typeof seedLevelSchema>;

/** POST /api/notify-me body. At least one contact; the phone is normalised server side. */
export const notifyMeSchema = z
  .object({
    variantId: z.uuid(),
    phone: z.string().trim().max(20).optional().transform((v) => v || undefined),
    email: z
      .email()
      .max(254)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    consent: z.literal(true),
  })
  .refine((v) => v.phone || v.email, { message: 'phone or email required', path: ['phone'] });
export type NotifyMeInput = z.infer<typeof notifyMeSchema>;

/** Module settings (rendered by admin-shell on /admin/settings/inventory). */
export const inventorySettingsSchema = z.object({
  defaultLowStockThreshold: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .default(5)
    .meta({ group: 'Stock', help: 'Used for variants without their own threshold. 0 turns low-stock alerts off for them.' }),
  notifyMeEnabled: z.boolean().default(true).meta({ group: 'Back in stock', help: 'Show "Notify me" on out-of-stock products.' }),
});
export type InventorySettings = z.infer<typeof inventorySettingsSchema>;
