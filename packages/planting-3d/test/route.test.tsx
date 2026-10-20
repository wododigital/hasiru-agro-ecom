import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import manifest from '../src/manifest';
import { planting3dMessages } from '../src/messages';
import Model3dPage, { generateMetadata } from '../src/routes/model-3d';
import { configurePlanting3d } from '../src/server';
import { Plan2d, PlantingViewerIsland, View3dLinkIsland } from '../src/ui';
import { buildViewerData, patchSpecFor } from '../src/domain';
import { commercial, hints } from './fixtures';

async function renderPage(model: string, search: Record<string, string> = {}): Promise<string> {
  const { prerenderToNodeStream } = await import('react-dom/static');
  const errors: unknown[] = [];
  const { prelude } = await prerenderToNodeStream(<Model3dPage params={Promise.resolve({ model })} searchParams={Promise.resolve(search)} />, {
    onError: (err) => void errors.push(err),
  });
  let html = '';
  for await (const chunk of prelude) html += chunk;
  if (errors.length) throw errors[0];
  return html;
}

const PLAN = '01a156c0-c5a0-7005-8b10-c7539c3f9df9';
const calls: { modelSlug: string; planId: string | null }[] = [];
const bind = () =>
  configurePlanting3d({
    layout: async (q) => {
      calls.push(q);
      return q.modelSlug === 'commercial' ? { layout: commercial, hints, landSqft: 43_560 } : null;
    },
  });

afterEach(() => {
  configurePlanting3d({});
  calls.length = 0;
});

describe('/models/[model]/3d', () => {
  it('is noindex and declared in the manifest', () => {
    expect(generateMetadata()).toMatchObject({ robots: { index: false, follow: true } });
    expect(manifest.routes).toEqual([{ path: '/models/[model]/3d', module: 'routes/model-3d', kind: 'page', exports: ['default', 'generateMetadata'] }]);
    expect(manifest.dependsOn).toEqual(['core', 'planting']);
  });

  it('renders the 2D plan first (server), with the legend from the catalogue, caption and a back link', async () => {
    bind();
    const html = await renderPage('commercial');
    expect(calls).toEqual([{ modelSlug: 'commercial', planId: null }]);
    expect(html).toContain('<h1');
    expect(html).toContain('<svg');
    expect(html).toContain('Fixture Mango, Fixture Guava');
    expect(html).toContain('39 plants on a 78 x 36 ft patch, spaced 6 ft along the row and 12 ft between rows.');
    expect(html).toContain('A patch like this repeats about 16 times across your land.');
    expect(html).toContain('href="/models/commercial"');
    // three is never part of the server render
    expect(html).not.toContain('<canvas');
  });

  it('passes a valid plan id through and links back to the plan; a bad plan id is ignored', async () => {
    bind();
    const html = await renderPage('commercial', { plan: PLAN });
    expect(calls.at(-1)).toEqual({ modelSlug: 'commercial', planId: PLAN });
    expect(html).toContain(`href="/plan/results/${PLAN}"`);
    await renderPage('commercial', { plan: 'not-a-uuid' });
    expect(calls.at(-1)).toEqual({ modelSlug: 'commercial', planId: null });
  });

  it('404s for an unknown model, an invalid slug, or when no layout source is bound', async () => {
    bind();
    await expect(renderPage('orchard')).rejects.toThrow();
    await expect(renderPage('../etc')).rejects.toThrow();
    configurePlanting3d({});
    await expect(renderPage('commercial')).rejects.toThrow();
  });
});

describe('components', () => {
  const data = buildViewerData({ layout: commercial, hints }, patchSpecFor('commercial'));

  it('2D plan: one canopy circle per plant, role letters, accessible name, scale bar', () => {
    const html = renderToStaticMarkup(<Plan2d data={data} label="Plan" feet="{n} ft" onPick={() => {}} />);
    expect(html.match(/<g role="button"/g)).toHaveLength(39);
    expect(html).toContain('aria-label="Plan"');
    expect(html).toContain('var(--color-role-main)');
    expect(html).toContain('20 ft'); // scale bar for a 72 ft span
    expect(html).toContain('6 ft');
    expect(html).toContain('12 ft');
  });

  it('viewer island hydrates on the 2D plan with the 3D toggle offered', () => {
    const html = renderToStaticMarkup(<PlantingViewerIsland data={data} messages={planting3dMessages} />);
    expect(html).toContain(planting3dMessages.view3d);
    expect(html).toContain('Flat top view.');
    expect(html).not.toContain(planting3dMessages.loadingTitle);
  });

  it('View in 3D link carries the CTA id and the href', () => {
    const html = renderToStaticMarkup(<View3dLinkIsland href="/models/commercial/3d">{planting3dMessages.viewIn3d}</View3dLinkIsland>);
    expect(html).toContain('href="/models/commercial/3d"');
    expect(html).toContain('data-cta="view-in-3d"');
  });
});
