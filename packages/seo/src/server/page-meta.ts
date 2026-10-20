import type { MetadataInput } from '@ecomkit/core/contracts';
import { audit } from '@ecomkit/core/audit';
import { tags } from '@ecomkit/core/cache-tags';
import { db } from '@ecomkit/core/db';
import { and, count, desc, eq, ilike } from 'drizzle-orm';
import type { Metadata } from 'next';
import { metadataFor, normalisePath } from '../domain';
import { seoPageMeta, type SeoPageMeta } from '../schema';
import { cacheFor, expireTags } from '@ecomkit/core/cache-tags';
import { seoRuntime } from './runtime';

/** Page meta overrides share the `settings:seo` tag: one admin save expires every page that read one. */
export const PAGE_META_TAG = tags.settings('seo');

/** Next metadata for a page from the bound site identity (sync; no override lookup). */
export function buildMetadata(input: MetadataInput): Metadata {
  return metadataFor(input, seoRuntime().site);
}

export async function getPageMeta(path: string): Promise<SeoPageMeta | null> {
  'use cache';
  cacheFor([PAGE_META_TAG]);
  const p = normalisePath(path);
  if (!p) return null;
  const [row] = await db.select().from(seoPageMeta).where(eq(seoPageMeta.path, p)).limit(1);
  return row ?? null;
}

/** Metadata with the admin's page meta override for this path applied (title, description, noindex, canonical, image). */
export async function pageMetadata(input: MetadataInput): Promise<Metadata> {
  const override = await getPageMeta(input.path);
  let image = input.image;
  if (override?.ogMediaId && seoRuntime().images) image = (await seoRuntime().images!([override.ogMediaId]))[override.ogMediaId] ?? image;
  return metadataFor({ ...input, image }, seoRuntime().site, override);
}

export interface PageMetaInput {
  path: string;
  title: string | null;
  description: string | null;
  noindex: boolean;
  canonical: string | null;
  ogMediaId: string | null;
}

export async function savePageMeta(input: PageMetaInput, actorId: string | null): Promise<SeoPageMeta> {
  const path = normalisePath(input.path);
  if (!path) throw new Error('invalid path');
  const canonical = input.canonical ? normalisePath(input.canonical) : null;
  const values = { title: input.title || null, description: input.description || null, noindex: input.noindex, canonical, ogMediaId: input.ogMediaId || null, updatedBy: actorId, updatedAt: new Date() };
  const [row] = await db.insert(seoPageMeta).values({ path, ...values }).onConflictDoUpdate({ target: seoPageMeta.path, set: values }).returning();
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'page_meta.upsert', entity: 'seo_page_meta', entityId: path, after: values });
  await expireTags([PAGE_META_TAG]);
  return row!;
}

export async function deletePageMeta(path: string, actorId: string | null): Promise<void> {
  await db.delete(seoPageMeta).where(eq(seoPageMeta.path, path));
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'page_meta.delete', entity: 'seo_page_meta', entityId: path });
  await expireTags([PAGE_META_TAG]);
}

export async function listPageMeta(input: { q?: string; page?: number; pageSize?: number } = {}): Promise<{ rows: SeoPageMeta[]; total: number }> {
  const pageSize = input.pageSize ?? 50;
  const where = and(input.q ? ilike(seoPageMeta.path, `%${input.q}%`) : undefined);
  const [rows, totals] = await Promise.all([
    db.select().from(seoPageMeta).where(where).orderBy(desc(seoPageMeta.updatedAt), seoPageMeta.path).limit(pageSize).offset(((input.page ?? 1) - 1) * pageSize),
    db.select({ total: count() }).from(seoPageMeta).where(where) as Promise<{ total: number }[]>,
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}

/** Paths an admin marked noindex (sitemap exclusion). */
export async function noindexPaths(): Promise<Set<string>> {
  const rows = await db.select({ path: seoPageMeta.path }).from(seoPageMeta).where(eq(seoPageMeta.noindex, true));
  return new Set(rows.map((r) => r.path));
}
