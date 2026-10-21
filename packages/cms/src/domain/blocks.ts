import { z } from 'zod';
import { href, optInt, optText, optUuid, reqText, type FieldSpec } from './fields';

const link = z.object({ label: reqText(80), href });
const optHeading = optText(160);
const optHref = z.preprocess((v) => (v === '' || v === null ? undefined : v), href.optional());

/** Product rail sources: the catalog's best sellers, a collection or tag (by slug), or hand-picked product ids. */
export const PRODUCT_RAIL_SOURCES = ['bestsellers', 'collection', 'tag', 'ids'] as const;
/** Registered component keys (calculators and the like) the host binds; lowercase with `_` or `-`. */
const componentKey = z.string().trim().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'a registered component key');

/** Every block type and its data. Adding a type = a schema here, a field list below and a renderer in ui. */
export const blockDataSchemas = {
  hero: z.object({ heading: reqText(160), subheading: optText(400), imageId: optUuid, ctas: z.array(link).max(2).default([]) }),
  rich_text: z.object({ html: z.string().max(100_000) }),
  faq: z.object({ heading: optHeading, items: z.array(z.object({ question: reqText(300), answer: reqText(4000) })).min(1).max(50) }),
  cta: z.object({ heading: reqText(160), body: optText(600), label: reqText(80), href }),
  video: z.object({ heading: optHeading, videoIds: z.array(z.uuid()).max(12).default([]), category: optText(60), limit: optInt(1, 12) }),
  trust_band: z.object({ heading: optHeading }),
  testimonials: z.object({ heading: optHeading, limit: optInt(1, 24) }),
  counters: z.object({ heading: optHeading }),
  gallery: z.object({ heading: optHeading, imageIds: z.array(z.uuid()).min(1).max(24) }),
  rail: z.object({ heading: optHeading, items: z.array(z.object({ title: reqText(120), href, imageId: optUuid, caption: optText(200) })).min(1).max(24) }),
  team: z.object({ heading: optHeading }),
  product_rail: z
    .object({
      eyebrow: optText(80),
      heading: optHeading,
      source: z.enum(PRODUCT_RAIL_SOURCES).default('bestsellers'),
      value: optText(120),
      productIds: z.array(z.uuid()).max(24).default([]),
      kind: z.enum(['plant', 'input']).default('plant'),
      limit: optInt(1, 24),
      linkLabel: optText(60),
      linkHref: optHref,
    })
    .refine((d) => d.source === 'bestsellers' || (d.source === 'ids' ? d.productIds.length > 0 : !!d.value), { message: 'a collection or tag slug, or product ids, for this source', path: ['value'] }),
  component: z.object({ key: componentKey, eyebrow: optText(80), heading: optHeading, body: optText(400) }),
} as const;

export type BlockType = keyof typeof blockDataSchemas;
export const BLOCK_TYPES = Object.keys(blockDataSchemas) as BlockType[];
export type BlockData<T extends BlockType> = z.output<(typeof blockDataSchemas)[T]>;
export type Block = { [T in BlockType]: { type: T; data: BlockData<T> } }[BlockType];

export const blockSchema = z.discriminatedUnion(
  'type',
  BLOCK_TYPES.map((t) => z.object({ type: z.literal(t), data: blockDataSchemas[t] })) as unknown as [z.ZodObject<{ type: z.ZodLiteral<BlockType>; data: z.ZodType }>],
) as unknown as z.ZodType<Block, unknown>;

export const blocksSchema = z.array(blockSchema).max(60);

/** Parses one stored block; null for an unknown type or data that no longer validates (skipped on render). */
export function parseBlock(type: string, data: unknown): Block | null {
  const r = blockSchema.safeParse({ type, data });
  return r.success ? r.data : null;
}

const linkFields: FieldSpec[] = [
  { name: 'label', label: 'Label', kind: 'text', required: true },
  { name: 'href', label: 'Link', kind: 'url', required: true, help: 'A path like /plants or an https link' },
];

/** Editor forms per block type (admin copy). */
export const BLOCK_FIELDS: Record<BlockType, { label: string; fields: readonly FieldSpec[] }> = {
  hero: {
    label: 'Hero',
    fields: [
      { name: 'heading', label: 'Heading', kind: 'text', required: true },
      { name: 'subheading', label: 'Subheading', kind: 'textarea' },
      { name: 'imageId', label: 'Image (media id)', kind: 'media' },
      { name: 'ctas', label: 'Buttons (up to 2)', kind: 'items', fields: linkFields },
    ],
  },
  rich_text: { label: 'Rich text', fields: [{ name: 'html', label: 'Text (HTML)', kind: 'html', required: true }] },
  faq: {
    label: 'FAQ',
    fields: [
      { name: 'heading', label: 'Heading', kind: 'text' },
      {
        name: 'items',
        label: 'Questions',
        kind: 'items',
        fields: [
          { name: 'question', label: 'Question', kind: 'text', required: true },
          { name: 'answer', label: 'Answer', kind: 'textarea', required: true },
        ],
      },
    ],
  },
  cta: {
    label: 'Call to action',
    fields: [
      { name: 'heading', label: 'Heading', kind: 'text', required: true },
      { name: 'body', label: 'Text', kind: 'textarea' },
      ...linkFields,
    ],
  },
  video: {
    label: 'Videos',
    fields: [
      { name: 'heading', label: 'Heading', kind: 'text' },
      { name: 'videoIds', label: 'Videos (ids, in order)', kind: 'media-list', help: 'Leave empty to use a category' },
      { name: 'category', label: 'Category', kind: 'text' },
      { name: 'limit', label: 'How many', kind: 'number' },
    ],
  },
  trust_band: { label: 'Trust band', fields: [{ name: 'heading', label: 'Heading', kind: 'text' }] },
  testimonials: {
    label: 'Testimonials',
    fields: [
      { name: 'heading', label: 'Heading', kind: 'text' },
      { name: 'limit', label: 'How many', kind: 'number' },
    ],
  },
  counters: { label: 'Results counters', fields: [{ name: 'heading', label: 'Heading', kind: 'text' }] },
  gallery: {
    label: 'Gallery',
    fields: [
      { name: 'heading', label: 'Heading', kind: 'text' },
      { name: 'imageIds', label: 'Images (media ids)', kind: 'media-list', required: true },
    ],
  },
  rail: {
    label: 'Card rail',
    fields: [
      { name: 'heading', label: 'Heading', kind: 'text' },
      {
        name: 'items',
        label: 'Cards',
        kind: 'items',
        fields: [
          { name: 'title', label: 'Title', kind: 'text', required: true },
          { name: 'href', label: 'Link', kind: 'url', required: true },
          { name: 'imageId', label: 'Image (media id)', kind: 'media' },
          { name: 'caption', label: 'Caption', kind: 'text' },
        ],
      },
    ],
  },
  team: { label: 'Team', fields: [{ name: 'heading', label: 'Heading', kind: 'text' }] },
  product_rail: {
    label: 'Product rail',
    fields: [
      { name: 'eyebrow', label: 'Eyebrow', kind: 'text' },
      { name: 'heading', label: 'Heading', kind: 'text' },
      {
        name: 'source',
        label: 'Products from',
        kind: 'select',
        required: true,
        options: [
          { value: 'bestsellers', label: 'Best sellers' },
          { value: 'collection', label: 'A collection' },
          { value: 'tag', label: 'A tag' },
          { value: 'ids', label: 'Hand-picked products' },
        ],
      },
      { name: 'value', label: 'Collection or tag slug', kind: 'text', help: 'For "A collection" or "A tag", e.g. fruiting' },
      { name: 'productIds', label: 'Products (ids, in order)', kind: 'media-list', help: 'For "Hand-picked products"' },
      {
        name: 'kind',
        label: 'Product type',
        kind: 'select',
        options: [
          { value: 'plant', label: 'Plants' },
          { value: 'input', label: 'Farm inputs' },
        ],
      },
      { name: 'limit', label: 'How many (default 12)', kind: 'number' },
      { name: 'linkLabel', label: 'Link label', kind: 'text', help: 'e.g. View all' },
      { name: 'linkHref', label: 'Link', kind: 'url' },
    ],
  },
  component: {
    label: 'Embedded tool',
    fields: [
      // Options are the host's registered components (filled in by the page editor).
      { name: 'key', label: 'Tool', kind: 'select', required: true, options: [] },
      { name: 'eyebrow', label: 'Eyebrow', kind: 'text' },
      { name: 'heading', label: 'Heading', kind: 'text' },
      { name: 'body', label: 'Text', kind: 'textarea' },
    ],
  },
};

/** Media ids a list of blocks shows (resolved in one batch before render). */
export function blockMediaIds(blocks: readonly Block[]): string[] {
  const ids: string[] = [];
  for (const b of blocks) {
    if (b.type === 'hero' && b.data.imageId) ids.push(b.data.imageId);
    if (b.type === 'gallery') ids.push(...b.data.imageIds);
    if (b.type === 'rail') for (const i of b.data.items) if (i.imageId) ids.push(i.imageId);
  }
  return [...new Set(ids)];
}
