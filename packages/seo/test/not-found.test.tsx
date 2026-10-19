import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { prerender } from 'react-dom/static';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import NotFound from '../src/routes/not-found';
import { seoNotFound } from '../src/schema';
import { configureSeo } from '../src/server';

// The proxy forwards the request path as x-pathname; Next's headers() is stubbed here.
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-pathname': '/Lost-Page/', referer: 'https://ref.example.org/from' }) }));

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb('wp-09-seo-404', { schemas: ['core', 'seo'] });
});
afterAll(async () => {
  await t?.close();
});

describe('app/not-found.tsx (seo/routes/not-found)', () => {
  it('renders the 404 page with search and host links, and logs the missed path', async () => {
    configureSeo({ site: { url: 'https://www.example.com', name: 'S', searchPath: '/search' }, notFoundLinks: [{ label: 'All plants', href: '/plants' }] });
    const { prelude } = await prerender(<NotFound />);
    const html = await new Response(prelude).text();
    expect(html).toMatch(/<h1[^>]*>Page not found<\/h1>/);
    expect(html).toContain('action="/search"');
    expect(html).toContain('href="/plants"');
    const rows = await t.db.select().from(seoNotFound);
    expect(rows).toMatchObject([{ path: '/lost-page', hits: 1, referrers: ['ref.example.org/from'] }]);
  });
});
