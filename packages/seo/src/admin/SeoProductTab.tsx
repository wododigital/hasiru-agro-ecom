import type { ProductFormTabProps } from '@ecomkit/core/contracts';
import { Button, FormField, Input } from '@ecomkit/ui';
import { DESCRIPTION_MAX, TITLE_MAX, canonicalUrl, clip, composeTitle } from '../domain';
import { listRedirects, seoRuntime } from '../server';
import { addRedirectForm, removeRedirectForm } from './actions';

function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return <span className={over ? 'text-danger' : 'text-muted'}>{`${value.length} / ${max}`}</span>;
}

/**
 * Product form tab "SEO" (productFormTabs): a search result preview with length counters, the indexing state,
 * and the redirects that land on this product with a form to add one (e.g. an old URL from the previous store).
 * Title, description and noindex themselves are product fields edited on the catalog's own tabs.
 */
export async function SeoProductTab({ productId }: ProductFormTabProps) {
  const rt = seoRuntime();
  const entity = productId && rt.entitySeo ? await rt.entitySeo('product', productId) : null;
  if (!entity) {
    return <p className="text-sm text-muted">Save the product first; the search preview and redirects appear once it has a page.</p>;
  }
  const title = composeTitle(entity.title, rt.site.name);
  const description = clip(entity.description, DESCRIPTION_MAX);
  const url = canonicalUrl(rt.site, entity.path);
  const { rows } = await listRedirects({ toPath: entity.path, pageSize: 100 });
  const back = `/admin/products/${productId}?tab=seo`;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="seo-preview" className="flex flex-col gap-2">
        <h3 id="seo-preview" className="text-base font-semibold">
          Search result preview
        </h3>
        <div className="max-w-xl rounded-lg border border-border bg-surface p-4">
          <p className="truncate text-xs text-muted">{url}</p>
          <p className="text-lg text-primary">{clip(title, TITLE_MAX + 10)}</p>
          <p className="text-sm text-text">{description || 'No description yet: search engines will pick text from the page.'}</p>
        </div>
        <p className="flex gap-4 text-xs">
          <span>
            Title <Counter value={title} max={TITLE_MAX} />
          </span>
          <span>
            Description <Counter value={entity.description} max={DESCRIPTION_MAX} />
          </span>
          <span className={entity.noindex ? 'text-danger' : 'text-success'}>{entity.noindex ? 'Hidden from search (noindex)' : 'Indexed and in the sitemap'}</span>
        </p>
      </section>

      <section aria-labelledby="seo-redirects" className="flex flex-col gap-3">
        <h3 id="seo-redirects" className="text-base font-semibold">
          Old addresses that lead here
        </h3>
        {rows.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <code>{r.fromPath}</code>
                <span className="text-muted">{`${r.hits} hits`}</span>
                <form action={removeRedirectForm}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="back" value={back} />
                  <Button type="submit" variant="ghost" size="sm" aria-label={`Delete redirect from ${r.fromPath}`}>
                    Delete
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">None yet. Renaming the product adds one automatically.</p>
        )}
        <form action={addRedirectForm} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="to" value={entity.path} />
          <input type="hidden" name="back" value={back} />
          <FormField id="seo-tab-from" label="Old path">
            {(c) => <Input {...c} name="from" placeholder="/product/old-name" required className="w-72" />}
          </FormField>
          <Button type="submit" size="sm">
            Add redirect
          </Button>
        </form>
      </section>
    </div>
  );
}
