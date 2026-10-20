// Slot calendar in Asia/Kolkata. IST has no daylight saving, so a fixed +05:30 offset is exact.
// Dates are `YYYY-MM-DD` strings (Postgres `date`), never Date objects, so no host time zone leaks in.

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The IST calendar date of an instant. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 00:00 IST on `date`. */
export function istMidnight(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS);
}

export interface Slot {
  id: string;
  /** 0 = Sunday .. 6 = Saturday. */
  weekday: number;
  /** Orders close this many hours before 00:00 IST of the slot day. */
  cutoffHours: number;
  /** Null = no weight cap for the day. */
  capacityKg: number | null;
}

export interface OpenSlot {
  date: string;
  slotId: string;
  /** Remaining kg; Number.MAX_SAFE_INTEGER when the day has no cap. */
  remainingKg: number;
}

/** A slot day still takes orders at `now` when now is strictly before its cutoff. */
export function isBeforeCutoff(date: string, cutoffHours: number, now: Date): boolean {
  return now.getTime() < istMidnight(date).getTime() - cutoffHours * 3_600_000;
}

export interface SlotQuery {
  now: Date;
  /** How many dates to return. */
  count: number;
  /** The order's weight; days without this much room are skipped. */
  weightKg: number;
  /** kg already booked per date. */
  bookedKg: ReadonlyMap<string, number>;
  blackout: ReadonlySet<string>;
  /** Search window in days (default 120). */
  horizonDays?: number;
}

/** The next open slot dates, earliest first. Several slot rows on one weekday: the first with room wins. */
export function openSlots(slots: readonly Slot[], q: SlotQuery): OpenSlot[] {
  const out: OpenSlot[] = [];
  if (q.count <= 0 || slots.length === 0) return out;
  const today = istDate(q.now);
  const horizon = q.horizonDays ?? 120;
  for (let i = 0; i <= horizon && out.length < q.count; i++) {
    const date = addDays(today, i);
    if (q.blackout.has(date)) continue;
    const booked = q.bookedKg.get(date) ?? 0;
    for (const s of slots) {
      if (s.weekday !== weekdayOf(date) || !isBeforeCutoff(date, s.cutoffHours, q.now)) continue;
      const remainingKg = s.capacityKg === null ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.round((s.capacityKg - booked) * 1000) / 1000);
      if (remainingKg < q.weightKg) continue;
      out.push({ date, slotId: s.id, remainingKg });
      break;
    }
  }
  return out;
}

const DATE_LABEL = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** `Saturday 24 Oct` for a YYYY-MM-DD date (the calendar date as given, no time zone shift). */
export function formatSlotDate(date: string): string {
  return DATE_LABEL.format(new Date(`${date}T00:00:00Z`)).replace(',', '');
}

/** Parses the comma or whitespace separated blackout setting; invalid entries are dropped. */
export function parseBlackout(value: string | null | undefined): Set<string> {
  return new Set((value ?? '').split(/[\s,]+/).filter((d) => DATE_RE.test(d)));
}
