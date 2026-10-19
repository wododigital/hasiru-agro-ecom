import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/types';

export type SequenceTx = Pick<DbOrTx, 'execute'>;

/**
 * Next value of a named gapless sequence. Run it inside the transaction that uses the number:
 * the upsert takes the row lock (same effect as SELECT ... FOR UPDATE + increment), concurrent callers
 * queue behind it, and a rollback returns the number, so committed values have no gaps.
 */
export async function nextInSequence(name: string, tx: SequenceTx): Promise<number> {
  const result = await tx.execute<{ value: string | number }>(
    sql`insert into core_sequence (name, value) values (${name}, 1)
        on conflict (name) do update set value = core_sequence.value + 1
        returning value`,
  );
  return Number(result.rows[0]!.value);
}

/** Indian financial year (April to March, IST) as `2026-27`. */
export function financialYear(at: Date = new Date()): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' })
    .format(at)
    .split('-')
    .map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** GST invoice number `INV-2026-27-00001`: one gapless sequence per financial year. */
export async function invoiceNumber(tx: SequenceTx, options: { prefix?: string; at?: Date } = {}): Promise<string> {
  const fy = financialYear(options.at);
  const n = await nextInSequence(`invoice:${fy}`, tx);
  return `${options.prefix ?? 'INV'}-${fy}-${String(n).padStart(5, '0')}`;
}
