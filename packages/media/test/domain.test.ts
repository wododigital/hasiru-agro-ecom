import { describe, expect, it } from 'vitest';
import {
  assetMetaSchema,
  baseOf,
  creditLine,
  DERIVATIVE_WIDTHS,
  masterKey,
  mediaLoader,
  mediaSrc,
  parseMediaPath,
  pickDerivative,
  planWidths,
  privateKey,
  sniff,
} from '../src/domain';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const HEX = 'ab0123456789abcdef0123456789abcd'.padEnd(32, '0');
const BASE = `ab/${HEX}`;

describe('sniff (type from bytes only)', () => {
  it.each([
    ['jpeg', bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'), 'image/jpeg'],
    ['png', bytes([0x89], 'PNG\r\n\x1a\n', [0, 0]), 'image/png'],
    ['gif87', bytes('GIF87a', [1, 0]), 'image/gif'],
    ['gif89', bytes('GIF89a', [1, 0]), 'image/gif'],
    ['webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'image/webp'],
    ['avif', bytes([0, 0, 0, 0x20], 'ftypavif', [0, 0]), 'image/avif'],
    ['avis', bytes([0, 0, 0, 0x20], 'ftypavis', [0, 0]), 'image/avif'],
  ])('%s is an image', (_, b, mime) => {
    expect(sniff(b)).toMatchObject({ kind: 'image', mime });
  });

  it('pdf is a document', () => {
    expect(sniff(bytes('%PDF-1.7\n'))).toEqual({ kind: 'document', mime: 'application/pdf', ext: 'pdf' });
  });

  it.each([
    ['plain svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['xml declaration', '<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg width="1">'],
    ['BOM and whitespace', '﻿   \n<SVG onload="alert(1)">'],
    ['self-closing', '<svg/>'],
  ])('refuses SVG (%s)', (_, text) => {
    expect(sniff(new TextEncoder().encode(text))).toEqual({ kind: 'refused', reason: 'svg' });
  });

  it('refuses HEIC with its own reason', () => {
    expect(sniff(bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0]))).toEqual({ kind: 'refused', reason: 'heic' });
  });

  it.each([
    ['html', '<!doctype html><script>alert(1)</script>'],
    ['text', 'hello'],
    ['exe', 'MZ\x90\x00'],
    ['empty', ''],
    ['truncated jpeg magic', '\xff\xd8'],
  ])('refuses unknown content (%s)', (_, text) => {
    expect(sniff(bytes(text))).toEqual({ kind: 'refused', reason: 'unknown' });
  });
});

describe('derivative planning', () => {
  it('uses the ladder up to the master width and never enlarges', () => {
    expect(planWidths(800)).toEqual([160, 320, 480, 640, 800]);
    expect(planWidths(1000)).toEqual([160, 320, 480, 640, 800, 960]);
    expect(planWidths(2560)).toEqual([...DERIVATIVE_WIDTHS]);
    for (const w of [1, 159, 161, 799, 1919, 5000]) expect(Math.max(...planWidths(w))).toBeLessThanOrEqual(w);
  });

  it('a master narrower than the ladder gets one derivative at its own width', () => {
    expect(planWidths(100)).toEqual([100]);
  });

  it('picks the smallest width that covers the request, AVIF when accepted', () => {
    const avail = [160, 320, 640].flatMap((width) => [{ width, format: 'avif' as const }, { width, format: 'webp' as const }]);
    expect(pickDerivative(avail, 300, true)).toEqual({ width: 320, format: 'avif' });
    expect(pickDerivative(avail, 320, false)).toEqual({ width: 320, format: 'webp' });
    expect(pickDerivative(avail, 3840, true)).toEqual({ width: 640, format: 'avif' });
    expect(pickDerivative(avail, 16, true)).toEqual({ width: 160, format: 'avif' });
    expect(pickDerivative([{ width: 160, format: 'webp' }], 100, true)).toEqual({ width: 160, format: 'webp' });
    expect(pickDerivative([], 100, true)).toBeNull();
  });
});

describe('paths and URLs', () => {
  it('maps storage keys to public URLs and refuses private ones', () => {
    expect(mediaSrc(masterKey(BASE))).toBe(`/media/m/${BASE}.webp`);
    expect(() => mediaSrc(privateKey(BASE, 'pdf'))).toThrow(/private/);
    expect(baseOf(masterKey(BASE))).toBe(BASE);
    expect(baseOf(privateKey(BASE, 'pdf'))).toBe(BASE);
  });

  it('parses only whitelisted media paths', () => {
    expect(parseMediaPath(['m', 'ab', `${HEX}.webp`])).toEqual({ type: 'file', key: `public/m/${BASE}.webp` });
    expect(parseMediaPath(['d', 'ab', HEX, '320.avif'])).toEqual({ type: 'file', key: `public/d/${BASE}/320.avif` });
    expect(parseMediaPath(['d', 'ab', HEX, 'share.jpg'])).toEqual({ type: 'file', key: `public/d/${BASE}/share.jpg` });
    expect(parseMediaPath(['w', '640', 'ab', HEX])).toEqual({ type: 'negotiate', width: 640, base: BASE });
    const id = '0192f1e2-3456-7abc-8def-0123456789ab';
    expect(parseMediaPath(['s', id])).toEqual({ type: 'signed', assetId: id });
  });

  it.each([
    [['m', '..', '..', 'etc', 'passwd']],
    [['m', 'ab', `${HEX}.webp`, '..']],
    [['d', 'ab', HEX, '..', '..', 'private', 'x.pdf']],
    [['private', 'ab', `${HEX}.pdf`]],
    [['m', 'AB', `${HEX.toUpperCase()}.webp`]],
    [['m', 'ab', `${HEX}.png`]],
    [['w', '0', 'ab', HEX]],
    [['w', '99999', 'ab', HEX]],
    [['s', 'not-a-uuid']],
    [['m', 'ab%2F..', `${HEX}.webp`]],
    [[]],
  ])('rejects %j', (segments) => {
    expect(parseMediaPath(segments)).toBeNull();
  });

  it('loader sends media masters to the width-negotiated URL and leaves other files alone', () => {
    expect(mediaLoader({ src: `/media/m/${BASE}.webp`, width: 640, quality: 75 })).toBe(`/media/w/640/${BASE}`);
    expect(mediaLoader({ src: '/logo.webp', width: 320 })).toBe('/logo.webp?w=320');
    expect(mediaLoader({ src: '/x.png?v=2', width: 320 })).toBe('/x.png?v=2&w=320');
  });
});

describe('metadata', () => {
  it('normalises form values', () => {
    expect(assetMetaSchema.parse({ alt: '  Mango tree ', licence: '', author: ' A. Person ', sourceUrl: '', creditRequired: 'on' })).toEqual({
      alt: 'Mango tree',
      licence: null,
      author: 'A. Person',
      sourceUrl: null,
      creditRequired: true,
    });
  });

  it('rejects non-http source URLs and unknown sources', () => {
    expect(assetMetaSchema.safeParse({ sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(assetMetaSchema.safeParse({ source: 'scraped' }).success).toBe(false);
    expect(assetMetaSchema.safeParse({ sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg' }).success).toBe(true);
  });

  it('credit line only when the licence requires it', () => {
    expect(creditLine({ creditRequired: true, author: 'A. Person', licence: 'CC BY-SA 4.0' })).toBe('A. Person, CC BY-SA 4.0');
    expect(creditLine({ creditRequired: false, author: 'A. Person', licence: 'CC BY 4.0' })).toBeNull();
    expect(creditLine({ creditRequired: true, author: null, licence: null })).toBeNull();
  });
});
