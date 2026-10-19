import { db } from '@ecomkit/core/db';
import { and, count, desc, eq, ilike, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { normalisePath } from '../domain';
import { seoNotFound, type SeoNotFound } from '../schema';
import { addRedirect, background, recordRedirectHit, redirectFor } from './redirects';

/** Scanner noise that is never a lost page: not worth a row. */
const PROBE_RE = /(\.(php\d?|aspx?|jsp|cgi|env|ini|sql|bak|ya?ml)$)|(^\/(wp-|xmlrpc|\.|cgi-bin|phpmyadmin|vendor\/))/i;

function referrerKey(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    return `${u.host}${u.pathname}`.slice(0, 200);
  } catch {
    return null;
  }
}

/** Counts a 404 for a path (normalised; scanner probes skipped). Keeps the last 10 distinct referrers. */
export async function logNotFound(path: string, referrer?: string | null): Promise<boolean> {
  const p = normalisePath(path);
  if (!p || PROBE_RE.test(p)) return false;
  const ref = referrerKey(referrer);
  const refs = ref ? [ref] : [];
  await db
    .insert(seoNotFound)
    .values({ path: p, referrers: refs })
    .onConflictDoUpdate({
      target: seoNotFound.path,
      set: {
        hits: sql`${seoNotFound.hits} + 1`,
        lastAt: sql`now()`,
        referrers: ref
          ? sql`array(select r from unnest(array[${ref}]::text[] || ${seoNotFound.referrers}) with ordinality as t(r, n) group by r order by min(n) limit 10)`
          : sql`${seoNotFound.referrers}`,
      },
    });
  return true;
}

/**
 * For a path no route matched: answer the redirect if there is one (counted after the response), else log the 404
 * and render not-found. Call before any Suspense boundary so the status code is real.
 */
export async function resolveMissing(path: string, referrer?: string | null): Promise<never> {
  const hit = await redirectFor(path);
  if (hit) {
    await background(() => recordRedirectHit(hit.from));
    if (hit.statusCode === 301 || hit.statusCode === 308) permanentRedirect(hit.to);
    redirect(hit.to);
  }
  await background(() => logNotFound(path, referrer));
  notFound();
}

export interface ListNotFoundInput {
  q?: string;
  fixed?: boolean | null;
  page?: number;
  pageSize?: number;
}

export async function listNotFound(input: ListNotFoundInput = {}): Promise<{ rows: SeoNotFound[]; total: number }> {
  const pageSize = input.pageSize ?? 50;
  const where = and(
    input.q ? ilike(seoNotFound.path, `%${input.q}%`) : undefined,
    input.fixed === true ? isNotNull(seoNotFound.fixedRedirectId) : input.fixed === false ? isNull(seoNotFound.fixedRedirectId) : undefined,
  );
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(seoNotFound)
      .where(where)
      .orderBy(desc(seoNotFound.hits), desc(seoNotFound.lastAt), seoNotFound.path)
      .limit(pageSize)
      .offset(((input.page ?? 1) - 1) * pageSize),
    db.select({ total: count() }).from(seoNotFound).where(where) as Promise<{ total: number }[]>,
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}

/** One-click fix from the 404 log: redirect the path and mark the row fixed. */
export async function fixNotFound(path: string, toPath: string, actorId: string | null): Promise<void> {
  await addRedirect(path, toPath, { source: 'not_found_fix', actorId });
}

export async function dismissNotFound(path: string): Promise<void> {
  await db.delete(seoNotFound).where(eq(seoNotFound.path, path));
}

/**
 * Job `seo.prune-not-found` (daily): drops rows not seen for 30 days with fewer than 5 hits, and fixed rows older
 * than 90 days, so a scanner flood cannot grow the table without bound.
 */
export async function pruneNotFound(now = new Date()): Promise<number> {
  const day = 86_400_000;
  const stale = await db
    .delete(seoNotFound)
    .where(and(lt(seoNotFound.lastAt, new Date(now.getTime() - 30 * day)), lt(seoNotFound.hits, 5)))
    .returning({ path: seoNotFound.path });
  const fixed = await db
    .delete(seoNotFound)
    .where(and(isNotNull(seoNotFound.fixedRedirectId), lt(seoNotFound.lastAt, new Date(now.getTime() - 90 * day))))
    .returning({ path: seoNotFound.path });
  return stale.length + fixed.length;
}
