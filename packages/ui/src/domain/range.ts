import type { DateRange } from '@ecomkit/core/contracts';
import { z } from 'zod';

/** Admin date range + compare (Home, Analytics, report pages): one parser and one comparison rule for every page. */

const isoDate = z.iso.date();

/** Today's date in India (YYYY-MM-DD). */
export function istDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Range from `?from=&to=`: valid dates, from <= to, at most 366 days; else the last 30 days in IST. */
export function parseRange(input: { from?: unknown; to?: unknown }, now: Date): DateRange {
  const today = istDate(now);
  const fallback = { from: shiftDays(today, -29), to: today };
  const from = isoDate.safeParse(input.from);
  const to = isoDate.safeParse(input.to);
  if (!from.success || !to.success || from.data > to.data) return fallback;
  if (shiftDays(from.data, 366) <= to.data) return fallback;
  return { from: from.data, to: to.data };
}

export type CompareMode = 'previous-period' | 'previous-year' | 'none';

/** Comparison window: the same-length period just before, or the same dates a year back. */
export function compareRange(range: DateRange, mode: CompareMode): DateRange | null {
  if (mode === 'none') return null;
  if (mode === 'previous-year') return { from: shiftDays(range.from, -365), to: shiftDays(range.to, -365) };
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  return { from: shiftDays(range.from, -days), to: shiftDays(range.from, -1) };
}

export const parseCompare = (v: unknown): CompareMode => (v === 'previous-year' || v === 'none' ? v : 'previous-period');

/** Change against the comparison; null when the comparison had nothing (shown as "new", not +100%). */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/** `?from=&to=&compare=` for links that keep the current range (report links, tabs). */
export function rangeQuery(range: DateRange, compare: CompareMode): string {
  return new URLSearchParams({ from: range.from, to: range.to, ...(compare === 'previous-period' ? {} : { compare }) }).toString();
}

/** Dashboard widgets whose id contains `.kpi.` are KPI cards: Home shows them as a strip above everything else, Analytics as its overview. */
export const isKpiWidget = (w: { id: string }): boolean => w.id.includes('.kpi.');
