import { audit } from '@ecomkit/core/audit';
import { db, withTx } from '@ecomkit/core/db';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { normalisePath, planRedirect } from '../domain';
import { seoNotFound, seoRedirect, type SeoRedirect } from '../schema';

export type RedirectSource = SeoRedirect['source'];
export type RedirectStatus = 301 | 302 | 307 | 308;

export class RedirectError extends Error {
  constructor(readonly reason: 'invalid' | 'same' | 'loop') {
    super(`redirect refused: ${reason}`);
    this.name = 'RedirectError';
  }
}

/** Runs `fn` after the response when inside a Next request, else right away (scripts, tests). */
export async function background(fn: () => Promise<unknown>): Promise<void> {
  try {
    const { after } = await import('next/server');
    after(() => fn().catch(() => undefined));
  } catch {
    await fn().catch(() => undefined);
  }
}

// ponytail: per-process map with a 30 s life; another process sees a new redirect within 30 s. Swap for a
// LISTEN/NOTIFY reset if that lag ever matters.
const TTL_MS = 30_000;
let memo: { at: number; map: Map<string, { to: string; statusCode: number }> } | null = null;

export function resetRedirectCache(): void {
  memo = null;
}

async function redirectMap(): Promise<Map<string, { to: string; statusCode: number }>> {
  // performance.now(), not Date.now(): the miss path runs inside a blocking prerender, where the clock is an unstable value
  if (memo && performance.now() - memo.at < TTL_MS) return memo.map;
  const rows = await db.select({ from: seoRedirect.fromPath, to: seoRedirect.toPath, statusCode: seoRedirect.statusCode }).from(seoRedirect);
  memo = { at: performance.now(), map: new Map(rows.map((r) => [r.from, { to: r.to, statusCode: r.statusCode }])) };
  return memo.map;
}

/** The redirect for a request path (any case, trailing slash or query), or null. Cheap: one cached map. */
export async function redirectFor(path: string): Promise<{ from: string; to: string; statusCode: number } | null> {
  const from = normalisePath(path);
  if (!from) return null;
  const hit = (await redirectMap()).get(from);
  return hit ? { from, ...hit } : null;
}

export async function recordRedirectHit(fromPath: string): Promise<void> {
  await db
    .update(seoRedirect)
    .set({ hits: sql`${seoRedirect.hits} + 1`, lastHitAt: new Date() })
    .where(eq(seoRedirect.fromPath, fromPath));
}

export interface AddRedirectOptions {
  source?: RedirectSource;
  statusCode?: RedirectStatus;
  actorId?: string | null;
}

/**
 * Adds or replaces `from -> to` as a single hop: loops are refused, a target that itself redirects is followed
 * to its end, and rows that pointed at `from` are re-pointed. Serialised with a transaction advisory lock so two
 * writers cannot build a loop between them. A 404 log row for `from` is marked fixed.
 * Signature-compatible with the catalog's `addRedirect(fromPath, toPath)` binding (slug changes).
 */
export async function addRedirect(fromPath: string, toPath: string, options: AddRedirectOptions = {}): Promise<SeoRedirect> {
  const source = options.source ?? (options.actorId ? 'manual' : 'slug_change');
  const row = await withTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('seo_redirect'))`);
    const existing = await tx.select({ from: seoRedirect.fromPath, to: seoRedirect.toPath }).from(seoRedirect);
    const plan = planRedirect(new Map(existing.map((r) => [r.from, r.to])), fromPath, toPath);
    if (!plan.ok) throw new RedirectError(plan.reason);

    let created: SeoRedirect | undefined;
    for (const [i, [from, to]] of plan.upserts.entries()) {
      const first = i === 0;
      const [r] = await tx
        .insert(seoRedirect)
        .values({ fromPath: from, toPath: to, statusCode: options.statusCode ?? 301, source })
        .onConflictDoUpdate({
          target: seoRedirect.fromPath,
          set: first ? { toPath: to, statusCode: options.statusCode ?? 301, source, updatedAt: new Date() } : { toPath: to, updatedAt: new Date() },
        })
        .returning();
      if (first) created = r;
    }
    await tx.update(seoNotFound).set({ fixedRedirectId: created!.id }).where(eq(seoNotFound.path, plan.from));
    await audit(
      { actorId: options.actorId ?? null, actorType: options.actorId ? 'staff' : 'system', action: 'redirect.upsert', entity: 'seo_redirect', entityId: created!.id, after: { from: plan.from, to: plan.to, source } },
      { tx },
    );
    return created!;
  });
  resetRedirectCache();
  return row;
}

export async function removeRedirect(id: string, actorId: string | null = null): Promise<void> {
  await withTx(async (tx) => {
    const [gone] = await tx.delete(seoRedirect).where(eq(seoRedirect.id, id)).returning();
    if (gone) {
      await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'redirect.delete', entity: 'seo_redirect', entityId: id, before: { from: gone.fromPath, to: gone.toPath } }, { tx });
    }
  });
  resetRedirectCache();
}

export interface ListRedirectsInput {
  q?: string;
  source?: RedirectSource | null;
  toPath?: string;
  sort?: 'from' | 'hits' | 'created' | null;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export async function listRedirects(input: ListRedirectsInput = {}): Promise<{ rows: SeoRedirect[]; total: number }> {
  const pageSize = input.pageSize ?? 50;
  const where = and(
    input.q ? or(ilike(seoRedirect.fromPath, `%${input.q}%`), ilike(seoRedirect.toPath, `%${input.q}%`)) : undefined,
    input.source ? eq(seoRedirect.source, input.source) : undefined,
    input.toPath ? eq(seoRedirect.toPath, input.toPath) : undefined,
  );
  const col = input.sort === 'from' ? seoRedirect.fromPath : input.sort === 'hits' ? seoRedirect.hits : seoRedirect.createdAt;
  const order: SQL[] = [input.dir === 'asc' ? asc(col) : desc(col), desc(seoRedirect.id)];
  const [rows, totals] = await Promise.all([
    db.select().from(seoRedirect).where(where).orderBy(...order).limit(pageSize).offset(((input.page ?? 1) - 1) * pageSize),
    db.select({ total: count() }).from(seoRedirect).where(where) as Promise<{ total: number }[]>,
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}
