import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedContext, SeedResult } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { z } from 'zod';
import { isPolicySlug, menuItemsSchema, pageSlugSchema, parseBlock, type Block } from '../domain';
import { cmsCounter, cmsMenu, cmsPage, cmsTeamMember, cmsTestimonial, cmsTrustClaim } from '../schema';
import { saveMenu } from './menus';
import { savePage } from './pages';
import { cmsRuntime } from './runtime';

/** The data pipeline writes counters as display strings ("850+"); split into the integer and its suffix. */
function splitCounter(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as { value?: unknown; suffix?: unknown };
  if (typeof r.value !== 'string') return raw;
  const m = /^(\d+)(.*)$/.exec(r.value.replace(/,/g, '').trim());
  return m ? { ...r, value: Number(m[1]), suffix: r.suffix ?? (m[2] || null) } : raw;
}

const page = z.object({
  slug: z.string(),
  title: z.string(),
  template: z.enum(['default', 'landing', 'policy', 'service']).optional(),
  status: z.enum(['draft', 'published']).default('draft'),
  noindex: z.boolean().default(false),
  blocks: z.array(z.object({ type: z.string(), props: z.record(z.string(), z.unknown()).default({}), sort: z.number().default(0) })).default([]),
  seo: z.object({ title: z.string().nullish(), description: z.string().nullish() }).default({}),
});
const link = z.object({ label: z.string(), href: z.string(), external: z.boolean().optional() });
const fileSchema = z.object({
  records: z.object({
    pages: z.array(page).default([]),
    menus: z.array(z.object({ key: z.string(), label: z.string().default(''), items: z.array(link.extend({ children: z.array(link).default([]) })).default([]) })).default([]),
    testimonials: z.array(z.object({ key: z.string(), author: z.string(), location: z.string().nullish(), body: z.string(), source: z.string().nullish(), avatar: z.string().nullish(), sort: z.number().default(0) })).default([]),
    team: z.array(z.object({ key: z.string(), name: z.string(), role: z.string().nullish(), bio: z.string().nullish(), photo: z.string().nullish(), sort: z.number().default(0) })).default([]),
    trust_claims: z.array(z.object({ key: z.string(), label: z.string(), value: z.string().nullish(), logo: z.string().nullish(), visible: z.boolean().default(false), sort: z.number().default(0) })).default([]),
    counters: z.array(z.preprocess(splitCounter, z.object({ key: z.string(), label: z.string(), value: z.number().int(), suffix: z.string().nullish(), verified: z.boolean().default(false), sort: z.number().default(0) }))).default([]),
  }),
});

/**
 * Seed hook `content`: data/seed/cms.json. Inserts only what is missing (by slug or key) and never overwrites
 * admin edits, so a second run changes nothing. Policy pages are always seeded noindex (the client's final
 * wording replaces the placeholder text) and published only when the file says so, since the storefront footer
 * links them. Blocks that do not validate are skipped with a note.
 */
export async function runSeed(ctx: SeedContext): Promise<SeedResult> {
  const file = join(ctx.seedDir, 'cms.json');
  if (!existsSync(file)) return { inserted: 0, updated: 0, skipped: 0, notes: ['cms.json not found'] };
  const { records } = fileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const r = { inserted: 0, updated: 0, skipped: 0, notes: [] as string[] };
  const keys = async <T>(rows: Promise<T[]>, pick: (row: T) => string | null) => new Set((await rows).map(pick).filter(Boolean));

  // The pipeline names images by master path (data/media/masters/<path>); the cms stores media ids. One lookup
  // for every image in the file: block `image` fields (hero, rail items), avatars, photos and logos.
  type Props = Record<string, unknown>;
  const itemImage = (it: unknown): string | null => (it && typeof it === 'object' && typeof (it as Props).image === 'string' ? ((it as Props).image as string) : null);
  const paths = new Set<string>();
  for (const p of records.pages)
    for (const b of p.blocks) {
      if (typeof b.props.image === 'string') paths.add(b.props.image);
      if (Array.isArray(b.props.items)) for (const it of b.props.items) if (itemImage(it)) paths.add(itemImage(it)!);
    }
  for (const t of records.testimonials) if (t.avatar) paths.add(t.avatar);
  for (const t of records.team) if (t.photo) paths.add(t.photo);
  for (const t of records.trust_claims) if (t.logo) paths.add(t.logo);
  const resolve = cmsRuntime().resolveMediaIds;
  const mediaIds: Record<string, string> = paths.size && resolve ? await resolve([...paths]) : {};
  const mediaId = (src: string | null | undefined): string | null => (src ? (mediaIds[src] ?? null) : null);
  const withMediaIds = ({ image, items, ...rest }: Props): Props => ({
    ...rest,
    ...(typeof image === 'string' && mediaId(image) ? { imageId: mediaId(image) } : {}),
    ...(Array.isArray(items)
      ? {
          items: items.map((it) => {
            const src = itemImage(it);
            if (!src) return it;
            const { image: _image, ...r } = it as Props;
            return mediaId(src) ? { ...r, imageId: mediaId(src) } : r;
          }),
        }
      : {}),
  });

  const existingPages = await keys(db.select({ slug: cmsPage.slug }).from(cmsPage), (x) => x.slug);
  for (const p of records.pages) {
    const slug = pageSlugSchema.safeParse(p.slug);
    if (!slug.success || existingPages.has(slug.data)) {
      r.skipped++;
      if (!slug.success) r.notes.push(`page ${p.slug}: invalid slug`);
      continue;
    }
    const blocks = [...p.blocks]
      .sort((a, b) => a.sort - b.sort)
      .map((b) => {
        const block = parseBlock(b.type, withMediaIds(b.props));
        if (!block) r.notes.push(`page ${slug.data}: block ${b.type} skipped (unknown type or invalid data)`);
        return block;
      })
      .filter((b): b is Block => b !== null);
    const policy = isPolicySlug(slug.data) || p.template === 'policy';
    if (!ctx.dryRun) {
      await savePage(
        null,
        {
          slug: slug.data,
          title: p.title,
          titleKn: undefined,
          status: p.status,
          template: policy ? 'policy' : (p.template ?? 'default'),
          seoTitle: p.seo.title ?? undefined,
          seoDescription: p.seo.description ?? undefined,
          noindex: policy ? true : p.noindex,
          publishedAt: null,
          blocks,
        },
        null,
      );
    }
    r.inserted++;
  }

  const existingMenus = await keys(db.select({ key: cmsMenu.key }).from(cmsMenu), (x) => x.key);
  for (const m of records.menus) {
    if (existingMenus.has(m.key)) {
      r.skipped++;
      continue;
    }
    const items = menuItemsSchema.safeParse(m.items);
    if (!items.success) {
      r.skipped++;
      r.notes.push(`menu ${m.key}: invalid links`);
      continue;
    }
    if (!ctx.dryRun) await saveMenu(m.key, m.label, items.data, null);
    r.inserted++;
  }

  const insertMissing = async <T>(rows: readonly T[], existing: Set<string | null>, key: (row: T) => string, insert: (rows: T[]) => Promise<unknown>) => {
    const fresh = rows.filter((x) => !existing.has(key(x)));
    r.skipped += rows.length - fresh.length;
    if (fresh.length && !ctx.dryRun) await insert(fresh);
    r.inserted += fresh.length;
  };

  await insertMissing(
    records.testimonials,
    await keys(db.select({ key: cmsTestimonial.key }).from(cmsTestimonial), (x) => x.key),
    (x) => x.key,
    (rows) =>
      db.insert(cmsTestimonial).values(rows.map((t) => ({ key: t.key, name: t.author, location: t.location ?? null, body: t.body, source: t.source ?? null, photoMediaId: mediaId(t.avatar), position: t.sort, status: 'published' as const }))),
  );
  await insertMissing(
    records.team,
    await keys(db.select({ key: cmsTeamMember.key }).from(cmsTeamMember), (x) => x.key),
    (x) => x.key,
    (rows) => db.insert(cmsTeamMember).values(rows.map((t) => ({ key: t.key, name: t.name, role: t.role ?? null, bio: t.bio ?? null, photoMediaId: mediaId(t.photo), position: t.sort, status: 'published' as const }))),
  );
  await insertMissing(
    records.counters,
    await keys(db.select({ key: cmsCounter.key }).from(cmsCounter), (x) => x.key),
    (x) => x.key,
    (rows) => db.insert(cmsCounter).values(rows.map((c) => ({ key: c.key, label: c.label, value: c.value, suffix: c.suffix ?? null, verified: c.verified, position: c.sort }))),
  );
  await insertMissing(
    records.trust_claims,
    await keys(db.select({ key: cmsTrustClaim.key }).from(cmsTrustClaim), (x) => x.key),
    (x) => x.key,
    (rows) =>
      db.insert(cmsTrustClaim).values(rows.map((t) => ({ key: t.key, label: t.label, value: t.value ?? null, logoMediaId: mediaId(t.logo), show: t.visible, position: t.sort }))),
  );

  ctx.log.info('cms content seeded', { inserted: r.inserted, skipped: r.skipped });
  return r;
}
