import type { Category } from './templates';

// ---- quiet hours (Asia/Kolkata, fixed +05:30, no DST) ------------------------------------
const IST_OFFSET_MIN = 330;
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Marketing messages wait until quiet hours end; utility and authentication messages always go.
 * Returns null when the message may go now, else the instant quiet hours end.
 * The window may wrap midnight (21:00 to 09:00). Equal start and end means no quiet hours.
 */
export function quietHoursRelease(now: Date, category: Category, window: { start: string; end: string }): Date | null {
  if (category !== 'marketing' || window.start === window.end) return null;
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  const istMs = now.getTime() + IST_OFFSET_MIN * 60_000;
  const minuteOfDay = Math.floor(istMs / 60_000) % 1440;
  const quiet = start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
  if (!quiet) return null;
  const wait = (end - minuteOfDay + 1440) % 1440;
  const release = new Date(Math.floor(now.getTime() / 60_000) * 60_000 + wait * 60_000);
  return release;
}

// ---- opt-out keywords ----------------------------------------------------------------------
const STOP_WORDS = new Set(['stop', 'stop all', 'unsubscribe', 'cancel', 'opt out', 'optout', 'end', 'quit']);
const START_WORDS = new Set(['start', 'unstop', 'subscribe']);

/** Inbound text that opts a number out of (or back into) marketing messages. */
export function optKeyword(text: string): 'stop' | 'start' | null {
  const t = text.trim().toLowerCase().replace(/[.!\s]+$/g, '').replace(/\s+/g, ' ');
  if (STOP_WORDS.has(t)) return 'stop';
  if (START_WORDS.has(t)) return 'start';
  return null;
}

// ---- service window --------------------------------------------------------------------------
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Free-form (non-template) WhatsApp text is allowed only within 24 h of the customer's last message. */
export const inServiceWindow = (lastInboundAt: Date | null, now: Date): boolean =>
  lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;

// ---- WhatsApp routing and errors ---------------------------------------------------------------
/** Marketing templates go to the Marketing Messages API; utility and authentication stay on Cloud API /messages. */
export function whatsappEndpoint(category: Category, marketingViaMmApi: boolean): 'marketing_messages' | 'messages' {
  return category === 'marketing' && marketingViaMmApi ? 'marketing_messages' : 'messages';
}

/** Per-user marketing limit: never retry the same number within 24 h. */
export const WA_PER_USER_MARKETING_LIMIT = 131049;
/** Throughput exceeded: retry with backoff. */
export const WA_THROUGHPUT = 130429;
const RETRIABLE_WA = new Set([WA_THROUGHPUT, 131000, 131016, 1, 2, 4, 80007]);

export type FailureKind = 'retry' | 'permanent' | 'suppress_marketing_24h';

/** How a provider failure is handled: retried by the job queue, failed for good, or failed with a 24 h marketing pause. */
export function classifyWhatsappError(code: number | null, httpStatus: number | null): FailureKind {
  if (code === WA_PER_USER_MARKETING_LIMIT) return 'suppress_marketing_24h';
  if (code !== null && RETRIABLE_WA.has(code)) return 'retry';
  if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500)) return 'retry';
  return 'permanent';
}

// ---- status precedence (webhooks arrive out of order; read may come without delivered) ---------------
const RANK = { queued: 0, skipped: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;
export type MessageStatus = keyof typeof RANK;

/** The status after a webhook: never moves backwards (delivered after read stays read); failed always wins. */
export function nextStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus {
  return RANK[incoming] > RANK[current] ? incoming : current;
}

// ---- masking --------------------------------------------------------------------------------
/** `+91•••••43210` / `a•••@example.com`: what the message log shows. */
export function maskAddress(address: string): string {
  const at = address.indexOf('@');
  if (at > 0) return `${address[0]}•••${address.slice(at)}`;
  return address.length > 7 ? `${address.slice(0, 3)}•••••${address.slice(-5)}` : '•••';
}

// ---- backoff ---------------------------------------------------------------------------------
/** Truncated exponential backoff with jitter: 2^n s + up to 1 s, at most `capSec`. */
export const backoffMs = (attempt: number, capSec = 32, jitter = Math.random()): number => Math.min(2 ** attempt * 1000 + Math.floor(jitter * 1000), capSec * 1000);
