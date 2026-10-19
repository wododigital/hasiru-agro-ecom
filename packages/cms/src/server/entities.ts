import { audit } from '@ecomkit/core/audit';
import { tags } from '@ecomkit/core/cache-tags';
import { db } from '@ecomkit/core/db';
import { safeHtml } from '@ecomkit/core/validation';
import { asc, count, desc, eq, ilike, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { ENTITIES, type EntityInput, type EntityKey } from '../domain';
import { cmsClient, cmsCounter, cmsPortfolioItem, cmsPost, cmsTeamMember, cmsTestimonial, cmsTrustClaim, cmsVideo } from '../schema';
import { expireTags } from './cache';
import { CmsWriteError } from './pages';
import { cmsRuntime } from './runtime';

type Row = Record<string, unknown>;

interface EntityTable {
  table: PgTable;
  id: PgColumn;
  /** Searched by the admin list and shown as the row title. */
  title: PgColumn;
  order: SQL[];
  /** Cache tags a write expires (the row before and after). */
  tags: (row: Row) => string[];
  /** Columns that hold rich text (sanitised on save). */
  html?: readonly string[];
  /** Unique slug column, when the type has one. */
  slug?: PgColumn;
}

export const ENTITY_TABLES: Record<EntityKey, EntityTable> = {
  guides: { table: cmsPost, id: cmsPost.id, title: cmsPost.title, order: [desc(cmsPost.createdAt)], tags: (r) => [tags.cms('guides'), tags.cms(`guide_${String(r.slug)}`)], html: ['bodyHtml'], slug: cmsPost.slug },
  videos: { table: cmsVideo, id: cmsVideo.id, title: cmsVideo.title, order: [asc(cmsVideo.position), desc(cmsVideo.createdAt)], tags: () => [tags.cms('videos')] },
  testimonials: { table: cmsTestimonial, id: cmsTestimonial.id, title: cmsTestimonial.name, order: [asc(cmsTestimonial.position), desc(cmsTestimonial.createdAt)], tags: () => [tags.cms('testimonials')] },
  portfolio: { table: cmsPortfolioItem, id: cmsPortfolioItem.id, title: cmsPortfolioItem.title, order: [asc(cmsPortfolioItem.position)], tags: () => [tags.cms('portfolio')], html: ['bodyHtml'], slug: cmsPortfolioItem.slug },
  clients: { table: cmsClient, id: cmsClient.id, title: cmsClient.name, order: [asc(cmsClient.position), asc(cmsClient.name)], tags: () => [tags.cms('clients')] },
  team: { table: cmsTeamMember, id: cmsTeamMember.id, title: cmsTeamMember.name, order: [asc(cmsTeamMember.position)], tags: () => [tags.cms('team')] },
  counters: { table: cmsCounter, id: cmsCounter.key, title: cmsCounter.label, order: [asc(cmsCounter.position)], tags: () => [tags.cms('counters')] },
  trust: { table: cmsTrustClaim, id: cmsTrustClaim.key, title: cmsTrustClaim.label, order: [asc(cmsTrustClaim.position)], tags: () => [tags.cms('trust')] },
};

// Drizzle cannot type one query over eight tables; these casts are the only untyped seam and stay in this file.
const q = db as unknown as {
  select: (fields?: unknown) => { from: (t: PgTable) => { where: (w?: SQL) => { orderBy: (...o: SQL[]) => { limit: (n: number) => { offset: (n: number) => Promise<Row[]> } }; limit: (n: number) => Promise<Row[]> } } };
  insert: (t: PgTable) => { values: (v: Row) => { returning: () => Promise<Row[]> } };
  update: (t: PgTable) => { set: (v: Row) => { where: (w: SQL) => { returning: () => Promise<Row[]> } } };
  delete: (t: PgTable) => { where: (w: SQL) => { returning: () => Promise<Row[]> } };
};

export async function listEntities(key: EntityKey, input: { q?: string; page?: number; pageSize?: number } = {}): Promise<{ rows: Row[]; total: number }> {
  const t = ENTITY_TABLES[key];
  const pageSize = input.pageSize ?? 50;
  const where = input.q ? ilike(t.title, `%${input.q}%`) : undefined;
  const [rows, totals] = await Promise.all([
    q.select().from(t.table).where(where).orderBy(...t.order).limit(pageSize).offset(((input.page ?? 1) - 1) * pageSize),
    db.select({ total: count() }).from(t.table).where(where),
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}

export async function getEntity(key: EntityKey, id: string): Promise<Row | null> {
  const t = ENTITY_TABLES[key];
  const [row] = await q.select().from(t.table).where(eq(t.id, id)).limit(1);
  return row ?? null;
}

/**
 * Creates (id null) or updates one row from validated input. Rich text is sanitised, a published guide without a
 * date is stamped now, a slug clash is a CmsWriteError, a published guide that changes slug gets a redirect.
 */
export async function saveEntity<K extends EntityKey>(key: K, id: string | null, input: EntityInput<K>, actorId: string | null): Promise<string> {
  const t = ENTITY_TABLES[key];
  const values: Row = Object.fromEntries(Object.entries(input as Row).map(([k, v]) => [k, v === undefined ? null : v]));
  for (const col of t.html ?? []) values[col] = safeHtml(String(values[col] ?? ''));
  const before = id ? await getEntity(key, id) : null;
  if (id && !before) throw new CmsWriteError('not_found');
  if (t.slug && values.slug) {
    const [clash] = await q.select({ id: t.id }).from(t.table).where(eq(t.slug, values.slug as string)).limit(1);
    if (clash && clash.id !== id) throw new CmsWriteError('slug_taken');
  }
  if (ENTITIES[key].idKind === 'key' && !before) {
    const [clash] = await q.select({ id: t.id }).from(t.table).where(eq(t.id, values.key as string)).limit(1);
    if (clash) throw new CmsWriteError('slug_taken');
  }
  if (key === 'guides' && values.status === 'published' && !values.publishedAt) values.publishedAt = before?.publishedAt ?? new Date();
  if ('updatedAt' in t.table) values.updatedAt = new Date();
  if (ENTITIES[key].idKind === 'key' && before) delete values.key; // keys are fixed once created

  const [row] = before ? await q.update(t.table).set(values).where(eq(t.id, id!)).returning() : await q.insert(t.table).values(values).returning();
  const rowId = String(ENTITIES[key].idKind === 'key' ? row!.key : row!.id);
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: `${key}.${before ? 'update' : 'create'}`, entity: `cms_${key}`, entityId: rowId, before, after: values });
  if (key === 'guides' && before && before.status === 'published' && before.slug !== row!.slug && cmsRuntime().addRedirect) {
    await cmsRuntime().addRedirect!(`/guides/${String(before.slug)}`, `/guides/${String(row!.slug)}`).catch(() => undefined);
  }
  await expireTags([...t.tags(row!), ...(before ? t.tags(before) : [])]);
  return rowId;
}

export async function deleteEntity(key: EntityKey, id: string, actorId: string | null): Promise<void> {
  const t = ENTITY_TABLES[key];
  const [gone] = await q.delete(t.table).where(eq(t.id, id)).returning();
  if (!gone) return;
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: `${key}.delete`, entity: `cms_${key}`, entityId: id, before: gone });
  await expireTags(t.tags(gone));
}

/** Row counts per type for the content hub. */
export async function entityCounts(): Promise<Record<EntityKey, number>> {
  const entries = await Promise.all(
    (Object.keys(ENTITY_TABLES) as EntityKey[]).map(async (k) => [k, (await db.select({ n: count() }).from(ENTITY_TABLES[k].table))[0]?.n ?? 0] as const),
  );
  return Object.fromEntries(entries) as Record<EntityKey, number>;
}
