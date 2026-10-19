'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@ecomkit/core/audit';
import { getViewer } from '@ecomkit/core/auth-context';
import { tags, invalidateTags } from '@ecomkit/core/cache-tags';
import { db } from '@ecomkit/core/db';
import { safeHtml, zodAction } from '@ecomkit/core/validation';
import { SLUG_RE } from '@ecomkit/core/ids';
import { placesDistrict } from '../schema';
import { invalidatePlacesCache } from '../server/cache';

const slug = z.string().regex(SLUG_RE).max(80);

async function save(slugValue: string, patch: Partial<typeof placesDistrict.$inferInsert>, action: string) {
  const viewer = await getViewer();
  const [before] = await db.select().from(placesDistrict).where(eq(placesDistrict.slug, slugValue)).limit(1);
  if (!before) return false;
  // Staff edits win over later re-seeds.
  await db.update(placesDistrict).set({ ...patch, adminLocked: true, updatedAt: new Date() }).where(eq(placesDistrict.slug, slugValue));
  await audit({
    actorId: viewer.kind === 'staff' ? viewer.userId : null,
    actorType: 'staff',
    action,
    entity: 'places_district',
    entityId: before.id,
    before: { pageEnabled: before.pageEnabled, pageIntroHtml: before.pageIntroHtml },
    after: patch,
  });
  invalidatePlacesCache();
  await invalidateTags([tags.district(slugValue)]);
  revalidatePath('/admin/places');
  return true;
}

export const setPageEnabled = zodAction(
  z.object({ slug, enabled: z.enum(['true', 'false']).transform((v) => v === 'true') }),
  async ({ slug: s, enabled }) => ({ saved: await save(s, { pageEnabled: enabled }, 'places.district.page_enabled') }),
  { permission: 'content.write' },
);

export const setPageIntro = zodAction(
  z.object({ slug, html: z.string().max(4000) }),
  async ({ slug: s, html }) => ({ saved: await save(s, { pageIntroHtml: html.trim() ? safeHtml(html) : null }, 'places.district.intro') }),
  { permission: 'content.write' },
);

/** Form actions return void; the page re-renders with the new state. */
export async function togglePageForm(formData: FormData): Promise<void> {
  await setPageEnabled(formData);
}
export async function introForm(formData: FormData): Promise<void> {
  await setPageIntro(formData);
}
