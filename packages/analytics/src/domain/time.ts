import type { DateRange } from '@ecomkit/core/contracts';
import type { Utm } from './privacy';

const DAY_MS = 86_400_000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Raw events and web vitals are kept this long; rollups and sessions are kept for good. */
export const RETENTION_DAYS = 90;

const istDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD of an instant in Asia/Kolkata. */
export function istDay(at: Date): string {
  return istDayFormat.format(at);
}

/** [start, end) instants of an IST calendar day. */
export function istDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function addDays(day: string, n: number): string {
  return istDay(new Date(istDayBounds(day).start.getTime() + n * DAY_MS + DAY_MS / 2));
}

/** Inclusive list of IST days in a range. */
export function daysIn(range: DateRange): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** [start, end) instants of an inclusive IST date range. */
export function rangeBounds(range: DateRange): { start: Date; end: Date } {
  return { start: istDayBounds(range.from).start, end: istDayBounds(range.to).end };
}

/** The equally long range just before `range` (for previous-period deltas). */
export function previousRange(range: DateRange): DateRange {
  const len = daysIn(range).length;
  return { from: addDays(range.from, -len), to: addDays(range.from, -1) };
}

/** Last `days` IST days ending today. */
export function lastDays(days: number, now: Date = new Date()): DateRange {
  const to = istDay(now);
  return { from: addDays(to, -(days - 1)), to };
}

const campaignKey = (utm: Utm | null) => (utm ? [utm.source, utm.medium, utm.campaign].join('|') : '');

/**
 * A visit starts a new session after 30 minutes without events, at IST midnight, or when it arrives
 * with campaign tags that differ from the current session's.
 */
export function startsNewSession(prev: { lastEventAt: Date; utm: Utm | null } | null, now: Date, utm: Utm | null): boolean {
  if (!prev) return true;
  if (now.getTime() - prev.lastEventAt.getTime() > SESSION_IDLE_MS) return true;
  if (istDay(now) !== istDay(prev.lastEventAt)) return true;
  return utm !== null && campaignKey(utm) !== campaignKey(prev.utm);
}

// ---- partitions (UTC calendar months) -------------------------------------

export interface MonthPartition {
  name: string;
  from: Date;
  to: Date;
}

export function monthPartition(year: number, monthIndex: number): MonthPartition {
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { name: `analytics_event_${from.getUTCFullYear()}_${String(from.getUTCMonth() + 1).padStart(2, '0')}`, from, to };
}

/** The current month and the next two: what must exist after the monthly job runs. */
export function partitionsToEnsure(now: Date): MonthPartition[] {
  return [0, 1, 2].map((i) => monthPartition(now.getUTCFullYear(), now.getUTCMonth() + i));
}

export const PARTITION_NAME_RE = /^analytics_event_(\d{4})_(\d{2})$/;

/** A month partition is dropped once every row in it is older than the retention window. */
export function isPartitionExpired(name: string, now: Date, retentionDays = RETENTION_DAYS): boolean {
  const m = PARTITION_NAME_RE.exec(name);
  if (!m) return false;
  const { to } = monthPartition(Number(m[1]), Number(m[2]) - 1);
  return to.getTime() <= now.getTime() - retentionDays * DAY_MS;
}
