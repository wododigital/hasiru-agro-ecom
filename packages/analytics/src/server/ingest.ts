import type { ConsentPurpose } from '@ecomkit/core/contracts';
import { db, upsertRequireUpdate } from '@ecomkit/core/db';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { parseBatch } from '../domain/payload';
import { cleanPath, scrubProps, type Utm } from '../domain/privacy';
import { botName, channelOf, deviceOf } from '../domain/sources';
import { startsNewSession } from '../domain/time';
import { VITAL_METRICS, type VitalMetric } from '../domain/reports';
import { analyticsEvent, analyticsSession, analyticsVisitor, analyticsWebVital } from '../schema';
import { isValidVisitorCookie, newVisitorCookie, visitorHash } from './visitor';

/** The customers module's consent lookup, wired by the host app. Absent means "no consent" (fail closed). */
export type HasConsent = (query: { customerId: string; purpose: ConsentPurpose }) => Promise<boolean>;

export interface IngestContext {
  /** Visitor cookie from the request; a missing or malformed one is replaced. */
  cookie: string | null;
  userAgent: string | null;
  country?: string | null;
  /** Signed-in customer, if any (identity is linked only with consent). */
  customerId?: string | null;
  /** Staff browsing the store: their sessions are test sessions. */
  isStaff?: boolean;
  hasConsent?: HasConsent;
  /** Host of the store (internal referrers count as direct). */
  siteHost?: string | null;
  now?: Date;
}

export type IngestResult =
  | { ok: false; reason: 'invalid' }
  | { ok: true; accepted: number; duplicates: number; rejected: number; cookie: string; visitorId: string; sessionId: string; linked: boolean };

/** Duplicates are looked up this far back; collector retries happen within seconds. */
const DEDUPE_WINDOW = sql`interval '7 days'`;

/**
 * Stores one beacon batch. Idempotent per client event id (a retried batch adds nothing), derives the session
 * server-side (30 min idle, IST midnight, new campaign), flags bots and test sessions, mirrors web_vital events
 * into analytics_web_vital, and links the visitor to the signed-in customer only with analytics_identity consent.
 * Batches of one visitor are serialised with an advisory lock so concurrent retries cannot double-insert.
 */
export async function ingest(body: unknown, ctx: IngestContext): Promise<IngestResult> {
  const batch = parseBatch(body);
  if (!batch) return { ok: false, reason: 'invalid' };
  const now = ctx.now ?? new Date();
  const cookie = isValidVisitorCookie(ctx.cookie) ? ctx.cookie : newVisitorCookie();
  const bot = botName(ctx.userAgent);
  const device = deviceOf(ctx.userAgent);

  const [visitor] = await upsertRequireUpdate(
    db,
    analyticsVisitor,
    { cookieHash: visitorHash(cookie), firstSeen: now, lastSeen: now, isBot: bot !== null },
    { target: analyticsVisitor.cookieHash, set: { lastSeen: now, isBot: sql`${analyticsVisitor.isBot} or excluded.is_bot` } },
  );
  const visitorId = visitor!.id;

  const events = batch.events.map((e) => ({ ...e, clean: cleanPath(e.p), props: scrubProps(e.d) }));
  const isTest = !!ctx.isStaff || events.some((e) => e.props.test === true);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${visitorId}, 7))`);

    const ids = [...new Set(events.map((e) => e.i))];
    const seen = ids.length
      ? await tx
          .select({ id: analyticsEvent.clientEventId })
          .from(analyticsEvent)
          .where(and(inArray(analyticsEvent.clientEventId, ids), gt(analyticsEvent.serverTs, sql`${now.toISOString()}::timestamptz - ${DEDUPE_WINDOW}`)))
      : [];
    const skip = new Set(seen.map((r) => r.id));
    const fresh: typeof events = [];
    for (const e of events) {
      if (skip.has(e.i)) continue;
      skip.add(e.i); // the same id twice in one batch counts once
      fresh.push(e);
    }

    const first = fresh.find((e) => e.n === 'page_view') ?? fresh[0] ?? events[0];
    const utm: Utm | null = first?.clean.utm ?? null;
    const [prev] = await tx
      .select({ id: analyticsSession.id, lastEventAt: analyticsSession.lastEventAt, utm: analyticsSession.utm })
      .from(analyticsSession)
      .where(eq(analyticsSession.visitorId, visitorId))
      .orderBy(desc(analyticsSession.lastEventAt))
      .limit(1);

    let sessionId: string;
    if (fresh.length && startsNewSession(prev ? { lastEventAt: prev.lastEventAt, utm: (prev.utm as Utm | null) ?? null } : null, now, utm)) {
      const [created] = await tx
        .insert(analyticsSession)
        .values({
          visitorId,
          startedAt: now,
          lastEventAt: now,
          landingPath: first?.clean.path ?? '/',
          referrerHost: batch.referrerHost,
          utm,
          device,
          channel: channelOf({ referrerHost: batch.referrerHost, utm, siteHost: ctx.siteHost ?? null }),
          isBot: bot !== null,
          botName: bot,
          isTest,
          country: ctx.country?.slice(0, 2).toUpperCase() || null,
        })
        .returning({ id: analyticsSession.id });
      sessionId = created!.id;
    } else if (prev) {
      sessionId = prev.id;
      if (fresh.length) {
        await tx
          .update(analyticsSession)
          .set({ lastEventAt: now, ...(isTest ? { isTest: true } : {}) })
          .where(eq(analyticsSession.id, sessionId));
      }
    } else {
      return null; // nothing new and no session yet: an all-duplicate batch from a visitor we have no session for
    }

    if (fresh.length) {
      await tx.insert(analyticsEvent).values(
        fresh.map((e) => ({
          clientEventId: e.i,
          sessionId,
          visitorId,
          name: e.n,
          path: e.clean.path,
          props: e.props,
          clientTs: Math.abs(e.t - now.getTime()) < 86_400_000 ? new Date(e.t) : null,
          serverTs: now,
        })),
      );
      const vitals = fresh.flatMap((e) => {
        const metric = e.props.m;
        const value = e.props.v;
        if (e.n !== 'web_vital' || typeof value !== 'number' || value < 0 || !VITAL_METRICS.includes(metric as VitalMetric)) return [];
        return [{ path: e.clean.path, metric: metric as VitalMetric, value: String(value), device, createdAt: now }];
      });
      if (vitals.length && bot === null) await tx.insert(analyticsWebVital).values(vitals);
    }
    return { sessionId, accepted: fresh.length };
  });

  let linked = false;
  if (ctx.customerId && ctx.hasConsent && !visitor!.customerId) {
    if (await ctx.hasConsent({ customerId: ctx.customerId, purpose: 'analytics_identity' })) {
      await db
        .update(analyticsVisitor)
        .set({ customerId: ctx.customerId })
        .where(and(eq(analyticsVisitor.id, visitorId), isNull(analyticsVisitor.customerId)));
      linked = true;
    }
  }

  return {
    ok: true,
    accepted: result?.accepted ?? 0,
    duplicates: events.length - (result?.accepted ?? 0),
    rejected: batch.rejected,
    cookie,
    visitorId,
    sessionId: result?.sessionId ?? '',
    linked: linked || (!!ctx.customerId && visitor!.customerId === ctx.customerId),
  };
}
