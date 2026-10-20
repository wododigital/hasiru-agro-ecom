import { DESCRIPTION_MAX, TITLE_MAX, type Destination, type FeedItem } from './item';

export interface FeedIssue {
  field: string;
  message: string;
  /** Errors keep the item out of the feed; warnings are reported only. */
  severity: 'error' | 'warning';
}

const isHttpsUrl = (v: string | null) => {
  if (!v) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Required fields per destination (Google Merchant Center product data spec; Meta catalog required fields):
 * id, title, description, link, image link, availability, price, brand (+ condition for Meta), plus the shape rules
 * that make Merchant Center reject an item (https links, positive price, pre-order date).
 */
export function validateFeedItem(item: FeedItem, destination: Destination, options: { requireHttps?: boolean } = {}): FeedIssue[] {
  const issues: FeedIssue[] = [];
  const err = (field: string, message: string) => issues.push({ field, message, severity: 'error' });
  const warn = (field: string, message: string) => issues.push({ field, message, severity: 'warning' });
  const requireHttps = options.requireHttps ?? true;

  if (!item.id || item.id.length > 50) err('id', 'id is required (at most 50 characters)');
  if (!item.title.trim()) err('title', 'title is required');
  else if (item.title.length > TITLE_MAX) err('title', `title is longer than ${TITLE_MAX} characters`);
  if (!item.description.trim()) err('description', 'description is required');
  else if (item.description.length > DESCRIPTION_MAX) err('description', `description is longer than ${DESCRIPTION_MAX} characters`);
  else if (item.description === item.title) warn('description', 'description only repeats the title');
  if (!item.link) err('link', 'link is required');
  else if (requireHttps && !isHttpsUrl(item.link)) err('link', 'link must be an https URL on the store domain');
  if (!item.imageLink) err('image_link', 'image is required (product has no photo yet)');
  else if (requireHttps && !isHttpsUrl(item.imageLink)) err('image_link', 'image link must be an https URL');
  if (item.pricePaise == null) err('price', 'price is required (variant has no price)');
  else if (item.pricePaise <= 0) err('price', 'price must be more than zero');
  if (item.salePricePaise != null && item.pricePaise != null && item.salePricePaise >= item.pricePaise) err('sale_price', 'sale price must be lower than the price');
  if (!item.brand.trim()) err('brand', 'brand is required (set it in the feed settings)');
  if (item.availability === 'preorder' && !item.availabilityDate) err('availability_date', 'pre-order items need an availability date');
  if (destination === 'google' && !item.googleProductCategory) warn('google_product_category', 'no Google product category set for this kind of product');
  if (destination === 'meta' && item.condition !== 'new') err('condition', 'condition is required');
  return issues;
}

export const hasErrors = (issues: readonly FeedIssue[]) => issues.some((i) => i.severity === 'error');
