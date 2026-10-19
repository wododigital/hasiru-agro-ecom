import type { Paise } from '../contracts/common';

export type { Paise } from '../contracts/common';

/** Brands an integer as paise. Throws on fractions, NaN and infinities, so a float never becomes money. */
export function asPaise(value: number): Paise {
  if (!Number.isSafeInteger(value)) throw new TypeError(`paise must be a safe integer, got ${value}`);
  return value as Paise;
}

/** Rupees (may carry paise as decimals) to integer paise. `paise(355.5)` is 35550. */
export function paise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) throw new TypeError(`invalid rupee amount ${rupees}`);
  return asPaise(Math.round(rupees * 100));
}

const fullFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const fractionFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * `Rs 1,23,456` (en-IN grouping). Paise show only when present: `Rs 99.50`.
 * `compact` gives `Rs 12.3L` / `Rs 1.2Cr` / `Rs 4.5K` for dashboards.
 */
export function formatINR(amount: Paise, options: { compact?: boolean } = {}): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const rupees = abs / 100;
  let body: string;
  if (options.compact) body = compactFormat.format(rupees);
  else body = abs % 100 === 0 ? fullFormat.format(rupees) : fractionFormat.format(rupees);
  return `${sign}Rs ${body}`;
}

/** Rounds to the nearest `step` rupees (half up). `roundToRs(paise(352), 5)` is Rs 350. */
export function roundToRs(amount: Paise, step = 1): Paise {
  const unit = step * 100;
  return asPaise(Math.round(amount / unit) * unit);
}

/**
 * Splits a GST-inclusive amount: tax = amount x r / (100 + r), rounded to the paisa (A7).
 * taxable + tax always equals the input.
 */
export function splitGstInclusive(amount: Paise, ratePct: number): { taxablePaise: Paise; taxPaise: Paise } {
  if (!(ratePct >= 0)) throw new RangeError(`invalid GST rate ${ratePct}`);
  const tax = Math.round((amount * ratePct) / (100 + ratePct));
  return { taxablePaise: asPaise(amount - tax), taxPaise: asPaise(tax) };
}

/** Intra-state: CGST + SGST (half each, odd paisa to SGST). Inter-state: all IGST. */
export function gstSplit(taxPaise: Paise, options: { interState: boolean }): { cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise } {
  if (options.interState) return { cgstPaise: asPaise(0), sgstPaise: asPaise(0), igstPaise: taxPaise };
  const cgst = Math.floor(taxPaise / 2);
  return { cgstPaise: asPaise(cgst), sgstPaise: asPaise(taxPaise - cgst), igstPaise: asPaise(0) };
}

export function sum(amounts: Iterable<Paise>): Paise {
  let total = 0;
  for (const a of amounts) total += a;
  return asPaise(total);
}

/** `percent` of an amount, rounded to the paisa. */
export function pct(amount: Paise, percent: number): Paise {
  return asPaise(Math.round((amount * percent) / 100));
}
