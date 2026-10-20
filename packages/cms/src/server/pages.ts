import { audit } from '@ecomkit/core/audit';
import { tags } from '@ecomkit/core/cache-tags';
import { db, withTx } from '@ecomkit/core/db';
import { safeHtml } from '@ecomkit/core/validation';
import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import { pagePath, pageTagKey, parseBlock, type Block, type PageInput } from '../domain';
import { cmsBlock, cmsPage, type CmsPage } from '../schema';
import { cacheFor, expireTags } from '@ecomkit/core/cache-tags';
import { cmsRuntime } from './runtime';

export const PAGES_TAG = tags.cms('pages');
export const pageTag = (slug: string) => tags.cms(pageTagKey(slug));

export interface PageWithBlocks {
  page: CmsPage;
  blocks: Block[];
}

export class CmsWriteError extends Error {
  constructor(readonly code: 'slug_taken' | 'not_found') {
    super(code);
    this.name = 'CmsWriteError';
  }
}

const cleanBlock = (b: Block): Block => (b.type === 'rich_text' ? { type: 'rich_text', data: { html: safeHtml(b.data.html) } } : b);

async function blocksOf(pageId: string): Promise<Block[]> {
  const rows = await db.select().from(cmsBlock).where(eq(cmsBlock.pageId, pageId)).orderBy(asc(cmsBlock.position), asc(cmsBlock.id));
  // Sanitised again on read: rows written outside savePage (SQL, restores) still render safely.
  return rows.map((r) => parseBlock(r.type, r.data)).filter((b): b is Block => b !== null).map(cleanBlock);
}

/** A published page and its valid blocks, or null (drafts never render on the storefront). */
export async function getPage(slug: string): Promise<PageWithBlocks | null> {
  'use cache';
  cacheFor([pageTag(slug), PAGES_TAG]);
  const [page] = await db
    .select()
    .from(cmsPage)
    .where(and(eq(cmsPage.slug, slug), eq(cmsPage.status, 'published')))
    .limit(1);
  return page ? { page, blocks: await blocksOf(page.id) } : null;
}

/** Published pages (slug, noindex, updatedAt) for static params and the sitemap. */
export async function publishedPages(): Promise<Pick<CmsPage, 'slug' | 'noindex' | 'updatedAt' | 'template'>[]> {
  'use cache';
  cacheFor([PAGES_TAG]);
  return db
    .select({ slug: cmsPage.slug, noindex: cmsPage.noindex, updatedAt: cmsPage.updatedAt, template: cmsPage.template })
    .from(cmsPage)
    .where(eq(cmsPage.status, 'published'))
    .orderBy(asc(cmsPage.slug));
}

// ---- admin -------------------------------------------------------------------

export async function listPages(input: { q?: string; template?: CmsPage['template'] | null; status?: CmsPage['status'] | null; page?: number; pageSize?: number } = {}) {
  const pageSize = input.pageSize ?? 50;
  const where = and(
    input.q ? or(ilike(cmsPage.title, `%${input.q}%`), ilike(cmsPage.slug, `%${input.q}%`)) : undefined,
    input.template ? eq(cmsPage.template, input.template) : undefined,
    input.status ? eq(cmsPage.status, input.status) : undefined,
  );
  const [rows, totals] = await Promise.all([
    db.select().from(cmsPage).where(where).orderBy(asc(cmsPage.slug)).limit(pageSize).offset(((input.page ?? 1) - 1) * pageSize),
    db.select({ total: count() }).from(cmsPage).where(where),
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}

/** Any status, for the admin editor. */
export async function getPageForEdit(id: string): Promise<PageWithBlocks | null> {
  const [page] = await db.select().from(cmsPage).where(eq(cmsPage.id, id)).limit(1);
  return page ? { page, blocks: await blocksOf(page.id) } : null;
}

/**
 * Creates (id null) or replaces a page and its blocks in one transaction. Rich text is sanitised here, once.
 * Publishing without a date stamps now. A published page that changes address gets a redirect through the bound
 * seo capability. Returns the page id.
 */
export async function savePage(id: string | null, input: PageInput, actorId: string | null): Promise<string> {
  const { blocks, ...fields } = input;
  const result = await withTx(async (tx) => {
    const [taken] = await tx.select({ id: cmsPage.id }).from(cmsPage).where(eq(cmsPage.slug, fields.slug)).limit(1);
    if (taken && taken.id !== id) throw new CmsWriteError('slug_taken');
    const before = id ? (await tx.select().from(cmsPage).where(eq(cmsPage.id, id)).limit(1))[0] : undefined;
    if (id && !before) throw new CmsWriteError('not_found');
    const values = {
      ...fields,
      titleKn: fields.titleKn ?? null,
      seoTitle: fields.seoTitle ?? null,
      seoDescription: fields.seoDescription ?? null,
      publishedAt: fields.publishedAt ?? (fields.status === 'published' ? (before?.publishedAt ?? new Date()) : null),
      updatedAt: new Date(),
    };
    const [row] = before ? await tx.update(cmsPage).set(values).where(eq(cmsPage.id, before.id)).returning() : await tx.insert(cmsPage).values(values).returning();
    await tx.delete(cmsBlock).where(eq(cmsBlock.pageId, row!.id));
    if (blocks.length) await tx.insert(cmsBlock).values(blocks.map((b, i) => ({ pageId: row!.id, position: i, ...cleanBlock(b) })));
    await audit(
      { actorId, actorType: actorId ? 'staff' : 'system', action: before ? 'page.update' : 'page.create', entity: 'cms_page', entityId: row!.id, before: before ?? null, after: { ...values, blocks: blocks.length } },
      { tx },
    );
    return { row: row!, before };
  });
  const { row, before } = result;
  if (before && before.slug !== row.slug && before.status === 'published' && cmsRuntime().addRedirect) {
    await cmsRuntime().addRedirect!(pagePath(before.slug), pagePath(row.slug)).catch(() => undefined);
  }
  await expireTags([PAGES_TAG, pageTag(row.slug), ...(before ? [pageTag(before.slug)] : []), tags.nav]);
  return row.id;
}

export async function deletePage(id: string, actorId: string | null): Promise<void> {
  const [gone] = await db.delete(cmsPage).where(eq(cmsPage.id, id)).returning();
  if (!gone) return;
  await audit({ actorId, actorType: actorId ? 'staff' : 'system', action: 'page.delete', entity: 'cms_page', entityId: id, before: gone });
  await expireTags([PAGES_TAG, pageTag(gone.slug)]);
}

/** Most recently edited first, for the content hub. */
export async function recentPages(limit = 5): Promise<CmsPage[]> {
  return db.select().from(cmsPage).orderBy(desc(cmsPage.updatedAt)).limit(limit);
}
