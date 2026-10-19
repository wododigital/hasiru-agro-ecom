/** QtyStepper rules (plan 5.0): never below 0, step 10 once qty >= 100, quick chips from 10, Enter commits a typed value. */

export const QTY_BIG_STEP_FROM = 100;
export const QTY_CHIPS_FROM = 10;
export const QTY_CHIPS = [10, 50] as const;

export interface QtyBounds {
  min?: number;
  max?: number;
}

export function clampQty(n: number, { min = 0, max = Number.MAX_SAFE_INTEGER }: QtyBounds = {}): number {
  if (!Number.isFinite(n)) return Math.max(0, min);
  return Math.min(Math.max(Math.trunc(n), Math.max(0, min)), max);
}

export const stepFor = (qty: number): number => (qty >= QTY_BIG_STEP_FROM ? 10 : 1);

export const incrementQty = (qty: number, bounds?: QtyBounds): number => clampQty(qty + stepFor(qty), bounds);

export const decrementQty = (qty: number, bounds?: QtyBounds): number => clampQty(qty - stepFor(qty), bounds);

export const showQuickChips = (qty: number): boolean => qty >= QTY_CHIPS_FROM;

/** Typed text to a quantity: digits only (commas and spaces ignored). Returns null for anything else so the caller keeps the old value. */
export function parseQty(text: string, bounds?: QtyBounds): number | null {
  const cleaned = text.replace(/[\s,]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  return clampQty(Number(cleaned), bounds);
}
