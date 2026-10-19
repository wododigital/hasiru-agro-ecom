// Pure search and facet logic: index build, bitset engine, URL codec, typeahead. No React, Next or DB.
export * from './bitset';
export * from './build-index';
export * from './engine';
export * from './facets';
export * from './suggest';
export * from './url-state';

/** Fills `{name}` placeholders. Messages are strings (not functions) so they can cross into client islands. */
export function fmt(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Product link from a template with `{kind}` and `{slug}`, e.g. `/{kind}/{slug}`. */
export function itemHref(template: string, item: { kind: string; slug: string }): string {
  return template.replace('{kind}', encodeURIComponent(item.kind)).replace('{slug}', encodeURIComponent(item.slug));
}
