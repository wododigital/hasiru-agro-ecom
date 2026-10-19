import { describe, expect, it } from 'vitest';
import {
  BLOCK_FIELDS,
  BLOCK_TYPES,
  ENTITIES,
  blockMediaIds,
  blocksSchema,
  emptyValues,
  istLocalToDate,
  dateToIstLocal,
  menuItemsSchema,
  menuTree,
  moveItem,
  pageInputSchema,
  parseBlock,
  removeItem,
  setIn,
  videoLinks,
  youtubeId,
} from '../src/domain';

const uuid = '0192a000-0000-7000-8000-0000000000aa';

describe('blocks', () => {
  it('every block type has editor fields and a schema', () => {
    expect(Object.keys(BLOCK_FIELDS).sort()).toEqual([...BLOCK_TYPES].sort());
    expect(BLOCK_TYPES).toEqual(['hero', 'rich_text', 'faq', 'cta', 'video', 'trust_band', 'testimonials', 'counters', 'gallery', 'rail', 'team']);
  });

  it('validates typed data, turns blank optional inputs into absent fields, rejects bad links', () => {
    const blocks = blocksSchema.parse([
      { type: 'hero', data: { heading: 'Grow a farm', subheading: '', imageId: '', ctas: [{ label: 'Shop', href: '/plants' }] } },
      { type: 'faq', data: { items: [{ question: 'Q?', answer: 'A.' }] } },
      { type: 'video', data: { heading: '', videoIds: [], category: 'diy', limit: '3' } },
      { type: 'cta', data: { heading: 'Talk to us', label: 'WhatsApp', href: 'https://wa.me/919999999999' } },
    ]);
    expect(blocks[0]).toEqual({ type: 'hero', data: { heading: 'Grow a farm', ctas: [{ label: 'Shop', href: '/plants' }] } });
    expect(blocks[2]).toEqual({ type: 'video', data: { videoIds: [], category: 'diy', limit: 3 } });
    for (const href of ['javascript:alert(1)', '//evil.com', 'http://insecure.example', 'data:text/html,x']) {
      expect(blocksSchema.safeParse([{ type: 'cta', data: { heading: 'h', label: 'l', href } }]).success, href).toBe(false);
    }
    expect(blocksSchema.safeParse([{ type: 'faq', data: { items: [] } }]).success).toBe(false);
    expect(parseBlock('marquee', {})).toBeNull();
    expect(parseBlock('gallery', { imageIds: ['nope'] })).toBeNull();
  });

  it('collects the media ids blocks show', () => {
    const blocks = blocksSchema.parse([
      { type: 'hero', data: { heading: 'h', imageId: uuid } },
      { type: 'gallery', data: { imageIds: [uuid] } },
      { type: 'rail', data: { items: [{ title: 't', href: '/x', imageId: uuid }] } },
    ]);
    expect(blockMediaIds(blocks)).toEqual([uuid]);
  });
});

describe('pages and menus', () => {
  const base = { title: 'T', status: 'draft', template: 'default', noindex: '', blocks: '[]' };

  it('page slugs: 1 to 3 kebab segments, never a reserved route root; policies get the policy template', () => {
    expect(pageInputSchema.parse({ ...base, slug: '/About/' }).slug).toBe('about');
    expect(pageInputSchema.parse({ ...base, slug: 'farm-development/site-assessment' }).slug).toBe('farm-development/site-assessment');
    const policy = pageInputSchema.parse({ ...base, slug: 'policies/delivery', template: 'default' });
    expect(policy.template).toBe('policy');
    for (const slug of ['cart', 'admin/x', 'a/b/c/d', 'Bad Slug', 'a_b', '']) expect(pageInputSchema.safeParse({ ...base, slug }).success, slug).toBe(false);
  });

  it('page form input: checkbox, IST publish time and block JSON from the editor', () => {
    const p = pageInputSchema.parse({ ...base, slug: 'x', noindex: 'on', publishedAt: '2026-10-20T10:00', blocks: JSON.stringify([{ type: 'rich_text', data: { html: '<p>x</p>' } }]) });
    expect(p.noindex).toBe(true);
    expect(p.publishedAt?.toISOString()).toBe('2026-10-20T04:30:00.000Z');
    expect(p.blocks).toHaveLength(1);
    expect(pageInputSchema.safeParse({ ...base, slug: 'x', blocks: '{not json' }).success).toBe(false);
    expect(istLocalToDate('nope')).toBeNull();
    expect(dateToIstLocal(new Date('2026-10-20T04:30:00Z'))).toBe('2026-10-20T10:00');
  });

  it('menu input and tree', () => {
    const items = menuItemsSchema.parse(JSON.stringify([{ label: 'Shop', href: '/plants', children: [{ label: 'Fruit', href: '/plants/fruit' }] }]));
    expect(items[0]!.children).toHaveLength(1);
    expect(menuItemsSchema.safeParse([{ label: 'x', href: 'javascript:void(0)' }]).success).toBe(false);
    const tree = menuTree([
      { id: 'b', parentId: null, label: 'B', href: '/b', position: 1, isExternal: false },
      { id: 'a', parentId: null, label: 'A', href: '/a', position: 0, isExternal: false },
      { id: 'a2', parentId: 'a', label: 'A2', href: '/a2', position: 1, isExternal: false },
      { id: 'a1', parentId: 'a', label: 'A1', href: '/a1', position: 0, isExternal: false },
      { id: 'orphan', parentId: 'gone', label: 'O', href: '/o', position: 0, isExternal: false },
    ]);
    expect(tree.map((n) => [n.label, n.children.map((c) => c.label)])).toEqual([
      ['A', ['A1', 'A2']],
      ['B', []],
    ]);
  });
});

describe('editor list operations', () => {
  it('move, remove, nested set and blank rows are pure', () => {
    const list = ['a', 'b', 'c'] as const;
    expect(moveItem(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(list, 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(list, 2, 1)).toEqual(['a', 'b', 'c']);
    expect(removeItem(list, 1)).toEqual(['a', 'c']);
    const rows = [{ type: 'faq', data: { items: [{ question: 'q', answer: 'a' }] } }];
    const next = setIn(rows, [0, 'data', 'items', 0, 'answer'], 'b');
    expect(next[0]!.data.items[0]!.answer).toBe('b');
    expect(rows[0]!.data.items[0]!.answer).toBe('a');
    expect(setIn([] as unknown[], [0, 'data', 'heading'], 'x')).toEqual([{ data: { heading: 'x' } }]);
    expect(emptyValues(BLOCK_FIELDS.hero.fields)).toEqual({ heading: '', subheading: '', imageId: '', ctas: [] });
  });
});

describe('videos and simple content types', () => {
  it('reads YouTube ids from every common URL shape', () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=3', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/embed/dQw4w9WgXcQ']) {
      expect(youtubeId(url), url).toBe('dQw4w9WgXcQ');
    }
    expect(youtubeId('https://vimeo.com/123')).toBeNull();
    expect(videoLinks('youtube', 'https://youtu.be/dQw4w9WgXcQ')).toEqual({
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      contentUrl: null,
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
  });

  it('entity schemas validate form input', () => {
    expect(ENTITIES.videos.schema.safeParse({ title: 't', url: 'http://x.example/v', kind: 'file' }).success).toBe(false);
    const v = ENTITIES.videos.schema.parse({ title: 't', url: 'https://youtu.be/dQw4w9WgXcQ', kind: 'youtube', productId: uuid, modelSlug: 'food-forest', position: '2' });
    expect(v).toMatchObject({ productId: uuid, modelSlug: 'food-forest', position: 2, status: 'draft' });
    expect(ENTITIES.counters.schema.parse({ key: 'acres', label: 'Acres', value: '120', verified: 'on' })).toMatchObject({ value: 120, verified: true, position: 0 });
    expect(ENTITIES.portfolio.schema.parse({ slug: 'x', title: 'X', gallery: `${uuid}\n${uuid}` }).gallery).toEqual([uuid, uuid]);
    expect(ENTITIES.testimonials.schema.safeParse({ name: 'n', body: 'b', rating: '6' }).success).toBe(false);
    expect(ENTITIES.guides.schema.safeParse({ slug: 'Bad Slug', title: 't' }).success).toBe(false);
  });
});
