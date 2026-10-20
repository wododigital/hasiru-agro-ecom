import { feedPrice, type FeedItem } from './item';

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
// Characters XML 1.0 does not allow in text (control characters other than tab, newline, carriage return).
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const text = (s: string) => xml(s.replace(XML_INVALID, ''));

/** Google Merchant Center RSS 2.0 feed with the `g:` namespace. */
export function renderGoogleXml(items: readonly FeedItem[], channel: { title: string; link: string; description: string }): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel>',
    `<title>${text(channel.title)}</title>`,
    `<link>${text(channel.link)}</link>`,
    `<description>${text(channel.description)}</description>`,
  ];
  for (const i of items) {
    const f: [string, string | null][] = [
      ['g:id', i.id],
      ['g:title', i.title],
      ['g:description', i.description],
      ['g:link', i.link],
      ['g:image_link', i.imageLink],
      ...i.additionalImageLinks.map((l): [string, string] => ['g:additional_image_link', l]),
      ['g:availability', i.availability],
      ['g:availability_date', i.availabilityDate],
      ['g:price', i.pricePaise != null ? feedPrice(i.pricePaise) : null],
      ['g:sale_price', i.salePricePaise != null ? feedPrice(i.salePricePaise) : null],
      ['g:brand', i.brand],
      ['g:condition', i.condition],
      ['g:identifier_exists', 'no'],
      ['g:item_group_id', i.itemGroupId],
      ['g:product_type', i.productType || null],
      ['g:google_product_category', i.googleProductCategory || null],
    ];
    out.push('<item>', ...f.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<${k}>${text(v!)}</${k}>`), '</item>');
  }
  out.push('</channel>', '</rss>', '');
  return out.join('\n');
}

export const META_COLUMNS = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'sale_price',
  'link',
  'image_link',
  'brand',
  'item_group_id',
  'product_type',
  'google_product_category',
] as const;

const META_AVAILABILITY: Readonly<Record<FeedItem['availability'], string>> = { in_stock: 'in stock', out_of_stock: 'out of stock', preorder: 'preorder' };

/** RFC 4180 field: quoted when it holds a comma, quote or line break. Values are sent as they are (Meta parses, no spreadsheet). */
export function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Meta catalog CSV data feed. */
export function renderMetaCsv(items: readonly FeedItem[]): string {
  const rows = items.map((i) =>
    [
      i.id,
      i.title,
      i.description,
      META_AVAILABILITY[i.availability],
      i.condition,
      i.pricePaise != null ? feedPrice(i.pricePaise) : '',
      i.salePricePaise != null ? feedPrice(i.salePricePaise) : '',
      i.link,
      i.imageLink ?? '',
      i.brand,
      i.itemGroupId ?? '',
      i.productType,
      i.googleProductCategory,
    ]
      .map(csvField)
      .join(','),
  );
  return `${[META_COLUMNS.join(','), ...rows].join('\r\n')}\r\n`;
}
