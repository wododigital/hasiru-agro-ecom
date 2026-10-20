import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';
import type { AuthContext, JsonLdBuilders, JsonLdNode, StaffViewer } from '@ecomkit/core/contracts';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { sql } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteEntityForm, saveEntityAction, saveMenuAction, savePageAction } from '../src/admin/actions';
import { EntityEditPage, MenuEditPage, PageEditPage } from '../src/admin/pages';
import { pageInputSchema } from '../src/domain';
import { cmsCounter, cmsPage, cmsTestimonial, cmsTrustClaim, cmsTeamMember } from '../src/schema';
import { configureCms, getMenu, saveEntity, savePage } from '../src/server';
import { NO_PAGE } from '../src/ui';
import About from '../src/routes/about';
import CatchAll, { generateMetadata as catchAllMetadata, generateStaticParams as catchAllParams } from '../src/routes/page';
import Guide from '../src/routes/guide';
import Guides from '../src/routes/guides';
import Policy from '../src/routes/policy';
import Videos from '../src/routes/videos';

let t: TestDb;
const uuid = (n: number) => `0192a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

async function html(node: ReactNode | Promise<ReactNode>): Promise<string> {
  const { prelude } = await prerender(<>{await node}</>);
  return new Response(prelude).text();
}
const digest = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (err) {
    return String((err as { digest?: string }).digest ?? (err as Error).message);
  }
  return 'no throw';
};
const ldGraph = (out: string) => JSON.parse(out.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]!) as { '@graph': JsonLdNode[] };

/** Minimal JsonLdBuilders: enough to see which nodes each page asks for. */
const fakeLd: JsonLdBuilders = {
  organization: () => ({ '@type': 'Organization' }),
  website: () => ({ '@type': 'WebSite' }),
  localBusiness: () => ({ '@type': 'Store' }),
  product: () => ({ '@type': 'Product' }),
  breadcrumbs: (items) => ({ '@type': 'BreadcrumbList', items: items.map((i) => i.path) }),
  faqPage: (items) => ({ '@type': 'FAQPage', count: items.length }),
  collectionPage: (c) => ({ '@type': 'CollectionPage', name: c.name }),
  article: (a) => ({ '@type': 'Article', headline: a.headline }),
  videoObject: (v) => ({ '@type': 'VideoObject', name: v.name }),
  graph: (nodes) => JSON.stringify({ '@graph': nodes }).replace(/</g, '\\u003c'),
};

const staff: AuthContext = {
  getViewer: async () => viewer,
  requirePermission: async (p) => {
    if (p !== 'content.write') throw new ForbiddenError();
    return viewer;
  },
  requireOwner: async () => {
    throw new Error('unused');
  },
};
const viewer: StaffViewer = { kind: 'staff', userId: uuid(99), name: 'Ed', email: 'ed@example.com', role: 'catalog_editor', permissions: ['content.write'] };
const onMissing = vi.fn(async (path: string): Promise<never> => {
  throw new Error(`missing ${path}`);
});

beforeAll(async () => {
  t = await createTestDb('wp-09-cms-routes', { schemas: ['core', 'cms'] });
});
afterAll(async () => {
  setAuthProvider(async () => null);
  await t?.close();
});
beforeEach(async () => {
  await t.db.execute(sql`truncate cms_page, cms_menu, cms_testimonial, cms_video, cms_post, cms_counter, cms_trust_claim, cms_team_member cascade`);
  onMissing.mockClear();
  configureCms({
    jsonLd: () => fakeLd,
    metadata: (input) => ({ title: `${input.title} | Store`, alternates: { canonical: input.path }, robots: { index: !input.noindex, follow: true } }),
    images: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, src: `/media/${id}.webp`, alt: 'img', width: 800, height: 600, blurDataURL: null, credit: null }])),
    onMissing,
  });
});

describe('storefront routes', () => {
  it('catch-all renders a landing page with every block type, one h1 and one JSON-LD graph', async () => {
    const video = await saveEntity('videos', null, { title: 'Pit digging', url: 'https://youtu.be/dQw4w9WgXcQ', kind: 'youtube', position: 0, status: 'published' }, null);
    await t.db.insert(cmsCounter).values([
      { key: 'acres', label: 'Acres developed', value: 1250, suffix: '+', verified: true },
      { key: 'farms', label: 'Unverified farms', value: 99, verified: false },
    ]);
    await t.db.insert(cmsTrustClaim).values([
      { key: 'reg', label: 'Registered startup', show: true },
      { key: 'rating', label: 'Hidden rating', value: '4.8', show: false },
    ]);
    await t.db.insert(cmsTestimonial).values({ name: 'Asha', location: 'Mysuru', body: 'Lovely saplings.', status: 'published' });
    await t.db.insert(cmsTeamMember).values({ name: 'Founder Name', role: 'Founder', status: 'published' });
    await savePage(
      null,
      pageInputSchema.parse({
        slug: 'farm-development',
        title: 'Farm development',
        template: 'landing',
        status: 'published',
        blocks: [
          { type: 'hero', data: { heading: 'From barren land to a living farm', imageId: uuid(1), ctas: [{ label: 'Talk to us', href: '/contact' }] } },
          { type: 'rich_text', data: { html: '<h2>Our process</h2><p>Five steps.</p>' } },
          { type: 'faq', data: { items: [{ question: 'How long does it take?', answer: 'About a season.' }] } },
          { type: 'counters', data: {} },
          { type: 'trust_band', data: {} },
          { type: 'testimonials', data: {} },
          { type: 'video', data: { videoIds: [video] } },
          { type: 'gallery', data: { imageIds: [uuid(2)] } },
          { type: 'rail', data: { items: [{ title: 'Site assessment', href: '/farm-development/site-assessment', imageId: uuid(3) }] } },
          { type: 'team', data: {} },
          { type: 'cta', data: { heading: 'Ready?', label: 'Start', href: '/build-farm-with-us' } },
        ],
      }),
      null,
    );
    const out = await html(CatchAll({ params: Promise.resolve({ slug: ['farm-development'] }) }));
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toMatch(/<h1[^>]*>From barren land to a living farm<\/h1>/);
    for (const text of ['Our process', 'How long does it take?', '1,250', 'Acres developed', 'Registered startup', 'Lovely saplings.', 'Pit digging', 'Watch on YouTube', 'Site assessment', 'Founder Name', 'Ready?']) {
      expect(out, text).toContain(text);
    }
    expect(out).not.toContain('Unverified farms');
    expect(out).not.toContain('Hidden rating');
    expect(out).toContain('href="https://youtu.be/dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer"');
    expect(out.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(ldGraph(out)['@graph'].map((n) => n['@type'])).toEqual(['Organization', 'WebSite', 'BreadcrumbList', 'FAQPage', 'VideoObject']);

    expect(await catchAllMetadata({ params: Promise.resolve({ slug: ['farm-development'] }) })).toMatchObject({ title: 'Farm development | Store', alternates: { canonical: '/farm-development' } });
    expect(await catchAllParams()).toEqual([{ slug: ['farm-development'] }]);
  });

  it('a path no page owns goes to the seo capability (redirect or logged 404); the placeholder param 404s', async () => {
    await expect(CatchAll({ params: Promise.resolve({ slug: ['product', 'old-mango'] }) })).rejects.toThrow('missing /product/old-mango');
    expect(onMissing).toHaveBeenCalledWith('/product/old-mango');
    expect(await digest(() => CatchAll({ params: Promise.resolve({ slug: [NO_PAGE] }) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    configureCms({});
    expect(await digest(() => CatchAll({ params: Promise.resolve({ slug: ['nope'] }) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await catchAllParams()).toEqual([{ slug: [NO_PAGE] }]);
  });

  it('policies 404 while draft, render once published; about carries LocalBusiness', async () => {
    const id = await savePage(null, pageInputSchema.parse({ slug: 'policies/delivery', title: 'Delivery policy', status: 'draft', blocks: [{ type: 'rich_text', data: { html: '<p>We deliver on Saturdays.</p>' } }] }), null);
    expect(await digest(() => Policy({ params: Promise.resolve({ slug: 'delivery' }) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    await t.db.update(cmsPage).set({ status: 'published' }).where(sql`id = ${id}`);
    const out = await html(Policy({ params: Promise.resolve({ slug: 'delivery' }) }));
    expect(out).toMatch(/<h1[^>]*>Delivery policy<\/h1>/);
    expect(out).toContain('Policies');
    expect(out).toContain('We deliver on Saturdays.');

    expect(await digest(() => About())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    await savePage(null, pageInputSchema.parse({ slug: 'about', title: 'About us', status: 'published', blocks: [] }), null);
    expect(ldGraph(await html(About()))['@graph'].map((n) => n['@type'])).toContain('Store');
  });

  it('guides list, guide article and videos page', async () => {
    await saveEntity('guides', null, { slug: 'pit-digging', title: 'How to dig a planting pit', excerpt: 'Size and depth.', bodyHtml: '<p>Dig 2 ft.</p><script>x</script>', publishedAt: null, status: 'published', noindex: false }, null);
    const list = await html(Guides());
    expect(list).toContain('How to dig a planting pit');
    expect(list).toContain('href="/guides/pit-digging"');
    const article = await html(Guide({ params: Promise.resolve({ slug: 'pit-digging' }) }));
    expect(article).toContain('<p>Dig 2 ft.</p>');
    expect(article).not.toContain('<script>x');
    expect(ldGraph(article)['@graph'].map((n) => n['@type'])).toEqual(['Organization', 'WebSite', 'BreadcrumbList', 'Article']);
    expect(await digest(() => Guide({ params: Promise.resolve({ slug: 'unknown' }) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');

    await saveEntity('videos', null, { title: 'Mulching', url: 'https://youtu.be/dQw4w9WgXcQ', kind: 'youtube', category: 'Soil', position: 0, status: 'published' }, null);
    await saveEntity('videos', null, { title: 'Grafting', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', kind: 'youtube', category: 'Plants', position: 1, status: 'published' }, null);
    const videos = await html(Videos());
    expect(videos).toContain('Mulching');
    expect(videos).toMatch(/<h2[^>]*>Soil<\/h2>/);
    expect(ldGraph(videos)['@graph'].filter((n) => n['@type'] === 'VideoObject')).toHaveLength(2);
  });
});

describe('admin: block editor, menus and simple types', () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it('is a 404 without content.write', async () => {
    setAuthProvider(async () => null);
    expect(await digest(() => PageEditPage({ params: Promise.resolve({ id: 'new' }), searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await savePageAction(form({ id: '', slug: 'x', title: 'X' }))).toMatchObject({ ok: false, formError: 'forbidden' });
  });

  it('page editor renders the block editor and saves blocks posted as JSON', async () => {
    setAuthProvider(async () => staff);
    const blocks = JSON.stringify([
      { type: 'hero', data: { heading: 'Hello', subheading: '', imageId: '', ctas: [] } },
      { type: 'faq', data: { heading: '', items: [{ question: 'Q?', answer: 'A.' }] } },
    ]);
    const saved = await digest(() => savePageAction(form({ id: '', slug: 'services/design', title: 'Design', status: 'published', template: 'service', blocks })));
    expect(saved).toMatch(/^NEXT_REDIRECT;replace;\/admin\/content\/pages\/[0-9a-f-]{36}\?saved=1;307;$/);
    const id = saved.split('/admin/content/pages/')[1]!.split('?')[0]!;

    const editor = await html(PageEditPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ saved: '1' }) }));
    expect(editor).toContain('1. Hero');
    expect(editor).toContain('2. FAQ');
    expect(editor).toContain('value="services/design"');
    expect(editor).toContain('Saved.');

    const bad = await savePageAction(form({ id: '', slug: 'checkout', title: 'X', blocks: '[{"type":"cta","data":{"heading":"h","label":"l","href":"javascript:alert(1)"}}]' }));
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.ok ? {} : bad.fieldErrors).sort()).toEqual(['blocks', 'slug']);
    const taken = await savePageAction(form({ id: '', slug: 'services/design', title: 'Copy' }));
    expect(taken).toMatchObject({ ok: false, fieldErrors: { slug: ['already used by another entry'] } });
  });

  it('menu editor saves two-level links', async () => {
    setAuthProvider(async () => staff);
    const items = JSON.stringify([{ label: 'Shop', href: '/plants', external: false, children: [{ label: 'Inputs', href: '/inputs', external: false }] }]);
    expect(await digest(() => saveMenuAction(form({ key: 'footer', label: 'Footer', items })))).toContain('/admin/content/menus/footer?saved=1');
    expect((await getMenu('footer'))[0]!.children[0]!.label).toBe('Inputs');
    expect(await html(MenuEditPage({ params: Promise.resolve({ key: 'footer' }), searchParams: Promise.resolve({}) }))).toContain('1. Link');
  });

  it('one generic form saves and deletes every simple type', async () => {
    setAuthProvider(async () => staff);
    expect(await digest(() => saveEntityAction(form({ _entity: 'counters', _id: '', key: 'acres', label: 'Acres', value: '40', verified: 'on' })))).toContain('/admin/content/counters/acres?saved=1');
    const editor = await html(EntityEditPage({ params: Promise.resolve({ entity: 'counters', id: 'acres' }), searchParams: Promise.resolve({}) }));
    expect(editor).toContain('Verified: show on the site');
    expect(await saveEntityAction(form({ _entity: 'nope' }))).toMatchObject({ ok: false, formError: 'invalid' });
    expect(await saveEntityAction(form({ _entity: 'testimonials', _id: '', name: '', body: '' }))).toMatchObject({ ok: false });
    expect(await digest(() => deleteEntityForm(form({ _entity: 'counters', _id: 'acres' })))).toContain('/admin/content/counters?deleted=1');
    expect(await t.db.select().from(cmsCounter)).toHaveLength(0);
  });
});
