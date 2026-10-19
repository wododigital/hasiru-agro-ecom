import { nextInSequence, type SequenceTx } from '../sequence';

export { newId } from './uuid';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lowercase ascii kebab-case. Accents are folded; anything else becomes a hyphen. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Indian mobile to E.164 (+91XXXXXXXXXX). Accepts spaces, dashes, brackets, a leading 0, 91 or +91.
 * Returns null for anything that is not a 10-digit number starting 6 to 9.
 */
export function normalisePhone(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) {
    if (!digits.startsWith('+91')) return null;
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

const IST = 'Asia/Kolkata';

/**
 * `<prefix>-YYMM-NNNNN` (YYMM in IST), e.g. `HA-2610-00042`; NNNNN from the gapless `order` sequence
 * inside the caller's transaction. The prefix is store config (orders settings), never hard-coded here.
 */
export async function orderNumber(tx: SequenceTx, options: { prefix: string; at?: Date }): Promise<string> {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: IST, year: '2-digit', month: '2-digit' }).formatToParts(options.at ?? new Date());
  const yy = parts.find((p) => p.type === 'year')!.value;
  const mm = parts.find((p) => p.type === 'month')!.value;
  const n = await nextInSequence('order', tx);
  return `${options.prefix}-${yy}${mm}-${String(n).padStart(5, '0')}`;
}
