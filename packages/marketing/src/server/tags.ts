import { audit } from '@ecomkit/core/audit';
import { NotFoundError, requirePermission } from '@ecomkit/core/auth-context';
import { expireTags } from '@ecomkit/core/cache-tags';
import { db } from '@ecomkit/core/db';
import { asc, desc, eq } from 'drizzle-orm';
import { tagInputSchema, type TagInput } from '../domain/tags';
import { marketingTag, type MarketingTagRow } from '../schema';
import { resetCspMemo, SETTINGS_TAG } from './config';

export async function listTags(): Promise<MarketingTagRow[]> {
  await requirePermission('marketing.write');
  return db.select().from(marketingTag).orderBy(desc(marketingTag.isActive), asc(marketingTag.name), asc(marketingTag.id));
}

export async function getTag(id: string): Promise<MarketingTagRow | null> {
  await requirePermission('marketing.write');
  const [row] = await db.select().from(marketingTag).where(eq(marketingTag.id, id));
  return row ?? null;
}

/** Creates or updates a custom tag (marketing.write), audits the change and expires the storefront tag config. */
export async function saveTag(raw: unknown): Promise<MarketingTagRow> {
  const staff = await requirePermission('marketing.write');
  const input: TagInput = tagInputSchema.parse(raw);
  const { id, ...fields } = input;
  const before = id ? (await db.select().from(marketingTag).where(eq(marketingTag.id, id)))[0] : undefined;
  if (id && !before) throw new NotFoundError();
  const [row] = before
    ? await db.update(marketingTag).set({ ...fields, updatedAt: new Date() }).where(eq(marketingTag.id, before.id)).returning()
    : await db.insert(marketingTag).values(fields).returning();
  await audit({ actorId: staff.userId, actorType: 'staff', action: before ? 'marketing.tag.update' : 'marketing.tag.create', entity: 'marketing_tag', entityId: row!.id, before: before ?? null, after: row! });
  resetCspMemo();
  await expireTags([SETTINGS_TAG]);
  return row!;
}

export async function deleteTag(id: string): Promise<void> {
  const staff = await requirePermission('marketing.write');
  const [row] = await db.delete(marketingTag).where(eq(marketingTag.id, id)).returning();
  if (!row) throw new NotFoundError();
  await audit({ actorId: staff.userId, actorType: 'staff', action: 'marketing.tag.delete', entity: 'marketing_tag', entityId: id, before: row, after: null });
  resetCspMemo();
  await expireTags([SETTINGS_TAG]);
}
