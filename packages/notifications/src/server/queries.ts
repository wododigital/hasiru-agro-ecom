import { db } from '@ecomkit/core/db';
import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { notificationsMessage } from '../schema';

export type MessageRow = typeof notificationsMessage.$inferSelect;

export const MESSAGE_FILTERS = {
  channel: ['email', 'whatsapp', 'sms', 'log'],
  status: ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'],
} as const;

/** Message log page: filters from the URL (DataTable params), newest first by default. */
export async function listMessages(p: { q: string; filters: Record<string, string>; sort: string | null; dir: 'asc' | 'desc'; page: number }, pageSize = 50): Promise<{ rows: MessageRow[]; total: number }> {
  const where: SQL[] = [];
  if (p.filters.channel) where.push(eq(notificationsMessage.channel, p.filters.channel as MessageRow['channel']));
  if (p.filters.status) where.push(eq(notificationsMessage.status, p.filters.status as MessageRow['status']));
  if (p.q) where.push(ilike(notificationsMessage.templateKey, `%${p.q.replace(/[%_\\]/g, '\\$&')}%`));
  const cond = where.length ? and(...where) : undefined;
  const order = p.sort === 'template' ? notificationsMessage.templateKey : notificationsMessage.queuedAt;
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(notificationsMessage)
      .where(cond)
      .orderBy(p.dir === 'asc' ? asc(order) : desc(order), desc(notificationsMessage.id))
      .limit(pageSize)
      .offset((p.page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(notificationsMessage).where(cond),
  ]);
  return { rows, total: count?.n ?? 0 };
}

/** The dev outbox: the latest messages with their rendered text, every channel. */
export const outboxMessages = (limit = 50): Promise<MessageRow[]> => db.select().from(notificationsMessage).orderBy(desc(notificationsMessage.queuedAt), desc(notificationsMessage.id)).limit(limit);
