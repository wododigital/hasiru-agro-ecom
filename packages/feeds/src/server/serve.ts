import { db } from '@ecomkit/core/db';
import { timingSafeEqual } from '@ecomkit/core/http';
import { desc, eq } from 'drizzle-orm';
import type { Destination } from '../domain/item';
import { feedsFile, feedsItemState, feedsRun, type FeedFileRow } from '../schema';
import { loadSettings } from './config';
import { regenerateFeeds } from './generate';

const plain = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

async function readFile(destination: Destination): Promise<FeedFileRow | null> {
  const [row] = await db.select().from(feedsFile).where(eq(feedsFile.destination, destination));
  return row ?? null;
}

/**
 * GET /feeds/google.xml?token=... and /feeds/meta.csv?token=...: the stored file, for the platforms' scheduled
 * fetch. 404 when the destination is off, 403 without the right token (constant-time compare). The first fetch
 * builds the file when none exists yet. Supports If-None-Match; never cached by intermediaries; noindex.
 */
export async function serveFeed(destination: Destination, req: Request): Promise<Response> {
  const s = await loadSettings();
  if (destination === 'google' ? !s.googleEnabled : !s.metaEnabled) return plain(404, 'not found');
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!s.feedToken || !token || !timingSafeEqual(token, s.feedToken)) return plain(403, 'forbidden');
  let file = await readFile(destination);
  if (!file) {
    await regenerateFeeds({ destinations: [destination] });
    file = await readFile(destination);
    if (!file) return plain(503, 'feed not ready');
  }
  const headers = {
    'content-type': file.contentType,
    etag: file.etag,
    'last-modified': file.generatedAt.toUTCString(),
    'cache-control': 'private, no-cache',
    'x-robots-tag': 'noindex',
  };
  if (req.headers.get('if-none-match') === file.etag) return new Response(null, { status: 304, headers });
  return new Response(file.body, { status: 200, headers });
}

export async function feedStatus(destination: Destination) {
  const [file, runs, errors] = await Promise.all([
    db.select({ items: feedsFile.items, generatedAt: feedsFile.generatedAt, etag: feedsFile.etag }).from(feedsFile).where(eq(feedsFile.destination, destination)),
    db.select().from(feedsRun).where(eq(feedsRun.destination, destination)).orderBy(desc(feedsRun.startedAt)).limit(10),
    db.select().from(feedsItemState).where(eq(feedsItemState.destination, destination)),
  ]);
  return { file: file[0] ?? null, runs, rejected: errors.filter((e) => e.lastError) };
}
