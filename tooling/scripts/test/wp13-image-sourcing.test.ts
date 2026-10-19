import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { binomial, licenceAllowed, parseCommons, scoreCandidate, sourceMissingImages, type Fetcher, type MissingPlant } from '../seed/source-missing-images';

const page = (title: string, over: Record<string, unknown> = {}, licence = 'CC BY-SA 4.0') => ({
  title: `File:${title}`,
  categories: [{ title: 'Category:Aegle marmelos' }],
  imageinfo: [
    {
      url: 'https://upload.example/full.jpg',
      thumburl: 'https://upload.example/thumb.jpg',
      thumbwidth: 1600,
      thumbheight: 1200,
      width: 4000,
      height: 3000,
      mime: 'image/jpeg',
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}`,
      extmetadata: { LicenseShortName: { value: licence }, Artist: { value: '<a href="x">Jane &amp; Co</a>' }, AttributionRequired: { value: 'true' }, ImageDescription: { value: 'A tree' } },
      ...over,
    },
  ],
});
const response = (...pages: ReturnType<typeof page>[]) => ({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(i), p])) } });

const plants: MissingPlant[] = [
  { key: 'aegle-marmelos-l-corr-a', name: 'Aegle marmelos', common: 'Bael (Bilva)', scientific: 'Aegle marmelos (L.) Corrêa' },
  { key: 'bael-duplicate', name: 'Bael', common: 'Bael', scientific: 'Aegle marmelos' },
  { key: 'carissa-carandas-l-hedge', name: 'Carissa', common: 'Karonda (hedge)', scientific: 'Carissa carandas L.' },
  { key: 'karonda', name: 'Karonda', common: 'Karonda', scientific: 'Carissa carandas' },
  { key: 'nothing-here', name: 'Nothing', common: 'Nothing', scientific: 'Nullus nullus' },
];

function fakeFetcher(calls: string[]): Fetcher {
  return async (url) => {
    calls.push(url);
    if (url.startsWith('https://upload.example/')) return new Response(Buffer.from('fake-jpeg-bytes'), { status: 200 });
    const q = new URL(url).searchParams.get('gsrsearch') ?? '';
    if (q.includes('Aegle marmelos')) {
      return Response.json(
        response(
          page('Aegle marmelos herbarium sheet.jpg'),
          page('Aegle marmelos fruit tree.jpg'),
          page('Aegle marmelos tree NC.jpg', {}, 'CC BY-NC 4.0'),
          page('Aegle marmelos tiny.jpg', { thumbwidth: 300, thumbheight: 200 }),
        ),
      );
    }
    if (q.includes('Carissa carandas')) return Response.json(response({ ...page('Carissa carandas fruit.jpg'), categories: [{ title: 'Category:Carissa carandas' }] }));
    return Response.json({ query: { pages: {} } });
  };
}

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'wp13-img-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('licence and ranking rules', () => {
  it('accepts CC BY, CC BY-SA, CC0 and public domain only', () => {
    for (const ok of ['CC BY 2.0', 'CC BY-SA 4.0', 'CC BY-SA 3.0 de', 'CC0', 'Public domain', 'PD-old']) expect(licenceAllowed(ok), ok).toBe(true);
    for (const no of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'CC BY-NC-SA 3.0', 'All rights reserved', '', 'GFDL']) expect(licenceAllowed(no), no).toBe(false);
  });
  it('reduces a scientific name to its binomial', () => {
    expect(binomial('Madhuca longifolia var. latifolia (Roxb.) A.Chev.')).toBe('Madhuca longifolia');
    expect(binomial('Adansonia digitata L.')).toBe('Adansonia digitata');
    expect(binomial('')).toBe('');
  });
  it('parses extmetadata, strips author markup, and rejects herbarium scans, small files and the wrong species', () => {
    const [c] = parseCommons(response(page('Aegle marmelos fruit tree.jpg')));
    expect(c).toMatchObject({ author: 'Jane & Co', licence: 'CC BY-SA 4.0', width: 1600 });
    expect(scoreCandidate(c!, 'Aegle marmelos', 'Bael')).toBeGreaterThan(10);
    expect(scoreCandidate({ ...c!, title: 'Aegle marmelos herbarium sheet.jpg' }, 'Aegle marmelos', 'Bael')).toBe(-1);
    expect(scoreCandidate({ ...c!, width: 500, height: 400 }, 'Aegle marmelos', 'Bael')).toBe(-1);
    expect(scoreCandidate({ ...c!, title: 'Other species tree.jpg', categories: ['Other'] }, 'Aegle marmelos', 'Bael')).toBe(-1);
    // a common name that is only the genus must not accept another species of it
    expect(scoreCandidate({ ...c!, title: 'Ehretia cymosa flowers.jpg', categories: ['Ehretia cymosa'] }, 'Ehretia aspera', 'Ehretia')).toBe(-1);
  });
});

describe('sourceMissingImages', () => {
  it('downloads the best allowed photo, records the licence trail, shares duplicates and logs misses', async () => {
    const mediaDir = tmp();
    const calls: string[] = [];
    const log = await sourceMissingImages({ mediaDir, plants, dryRun: false, fetcher: fakeFetcher(calls), now: () => new Date('2026-10-20T00:00:00Z') });

    const bael = log.plants['aegle-marmelos-l-corr-a']!;
    expect(bael).toMatchObject({ status: 'sourced', engine: 'wikimedia', licence: 'CC BY-SA 4.0', author: 'Jane & Co', credit_required: true, file: 'sourced/aegle-marmelos-l-corr-a.jpg' });
    expect(bael.source_url).toContain('commons.wikimedia.org/wiki/File:Aegle');
    expect(bael.credit).toBe('Photo: Jane & Co, CC BY-SA 4.0, via Wikimedia Commons');
    expect(bael.subject).toBe('Aegle marmelos fruit tree.jpg');
    const bytes = readFileSync(join(mediaDir, 'masters', bael.file!));
    expect(bael.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(bael.searches[0]).toMatchObject({ engine: 'wikimedia', results: 4, accepted: 1 });

    expect(log.plants['bael-duplicate']).toMatchObject({ status: 'shared', same_as: 'aegle-marmelos-l-corr-a' });
    expect(log.plants['carissa-carandas-l-hedge']).toMatchObject({ status: 'shared', same_as: 'karonda' });
    expect(log.plants['nothing-here']).toMatchObject({ status: 'missing' });
    expect(readdirSync(join(mediaDir, 'masters', 'sourced')).sort()).toEqual(['aegle-marmelos-l-corr-a.jpg', 'karonda.jpg']);
    expect(JSON.parse(readFileSync(join(mediaDir, 'sourcing-log.json'), 'utf8')).policy).toMatch(/No AI-generated/);
  });

  it('is idempotent: a second run makes no requests and changes no file', async () => {
    const mediaDir = tmp();
    await sourceMissingImages({ mediaDir, plants, dryRun: false, fetcher: fakeFetcher([]) });
    const before = readFileSync(join(mediaDir, 'sourcing-log.json'), 'utf8').replace(/"generated_at": ".*"/, '');
    const calls: string[] = [];
    await sourceMissingImages({ mediaDir, plants, dryRun: false, fetcher: fakeFetcher(calls) });
    expect(calls).toEqual([]);
    expect(readFileSync(join(mediaDir, 'sourcing-log.json'), 'utf8').replace(/"generated_at": ".*"/, '')).toBe(before);
  });

  it('--dry-run touches nothing on disk and makes no request', async () => {
    const mediaDir = tmp();
    await sourceMissingImages({ mediaDir, plants: plants.slice(0, 1), dryRun: false, fetcher: fakeFetcher([]) });
    const snapshot = (dir: string): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (d: string) => {
        for (const name of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, name.name);
          if (name.isDirectory()) walk(p);
          else out[p.slice(dir.length)] = createHash('sha256').update(readFileSync(p)).digest('hex');
        }
      };
      walk(dir);
      return out;
    };
    const before = snapshot(mediaDir);
    const calls: string[] = [];
    await sourceMissingImages({ mediaDir, plants, dryRun: true, fetcher: fakeFetcher(calls) });
    expect(calls).toEqual([]);
    expect(snapshot(mediaDir)).toEqual(before);

    const fresh = tmp();
    await sourceMissingImages({ mediaDir: fresh, plants, dryRun: true, fetcher: fakeFetcher(calls) });
    expect(readdirSync(fresh)).toEqual([]);
    expect(existsSync(join(fresh, 'sourcing-log.json'))).toBe(false);
  });
});
