import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BEACON_JS } from '../src/domain/beacon';
import { beaconBatchSchema, beaconEventSchema } from '../src/domain/payload';

type Handler = (ev: Record<string, unknown>) => void;
type Sent = { e: { i: string; n: string; p: string; t: number; d: Record<string, unknown> }[]; r: string };

/** Just enough of a browser to run the collector: listeners, history, sendBeacon, timers driven by hand. */
function fakeBrowser(href: string, options: { referrer?: string; preload?: unknown[] } = {}) {
  const listeners = new Map<string, Handler[]>();
  const on = (scope: string) => (type: string, fn: Handler) => listeners.set(`${scope}:${type}`, [...(listeners.get(`${scope}:${type}`) ?? []), fn]);
  const fire = (scope: string, type: string, ev: Record<string, unknown> = {}) => (listeners.get(`${scope}:${type}`) ?? []).forEach((fn) => fn(ev));
  const sent: Sent[] = [];
  const timeouts: (() => void)[] = [];
  const url = new URL(href);
  const location = {
    get href() {
      return url.href;
    },
    get pathname() {
      return url.pathname;
    },
  };
  class Element {
    tagName = 'BUTTON';
    id = '';
    textContent = '';
    constructor(private attrs: Record<string, string> = {}) {}
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    }
    hasAttribute(k: string) {
      return k in this.attrs;
    }
    closest(sel: string) {
      if (sel === '[data-cta]') return 'data-cta' in this.attrs ? this : null;
      if (sel.startsWith('a,button')) return this;
      return null;
    }
  }
  const document = {
    currentScript: { getAttribute: (k: string) => (k === 'data-e' ? '/api/beacon-ingest' : null) },
    referrer: options.referrer ?? '',
    hidden: false,
    documentElement: { scrollHeight: 2000 },
    addEventListener: on('document'),
    querySelectorAll: () => [],
  };
  const history = {
    pushState: (_s: unknown, _t: string, to: string) => {
      const next = new URL(to, url);
      url.pathname = next.pathname;
      url.search = next.search;
    },
    replaceState: () => undefined,
  };
  const window: Record<string, unknown> = {
    addEventListener: on('window'),
    __ekq: options.preload,
  };
  const context = {
    window,
    document,
    navigator: { sendBeacon: (_url: string, body: string) => (sent.push(JSON.parse(body) as Sent), true) },
    location,
    history,
    crypto: webcrypto,
    URL,
    URLSearchParams,
    Uint8Array,
    Element,
    Date,
    Math,
    String,
    JSON,
    Object,
    WeakMap,
    MutationObserver: class {
      observe() {}
    },
    PerformanceObserver: class {
      observe() {
        throw new Error('unsupported in the fake');
      }
    },
    performance: { getEntriesByType: () => [{ responseStart: 180 }] },
    getComputedStyle: () => ({ cursor: 'pointer' }),
    setInterval: () => 0,
    setTimeout: (fn: () => void) => timeouts.push(fn),
    fetch: () => Promise.resolve(),
    scrollY: 0,
    innerHeight: 800,
  };
  runInNewContext(BEACON_JS, context);
  const events = () => sent.flatMap((b) => b.e);
  return { window, document, history, fire, sent, events, timeouts, Element, context };
}

describe('collector script', () => {
  it('transfers under 3 KB (gzip, as served) and is parseable JavaScript', () => {
    expect(gzipSync(BEACON_JS).length).toBeLessThan(3 * 1024);
    expect(Buffer.byteLength(BEACON_JS)).toBeLessThan(5 * 1024); // raw ceiling so growth is noticed
    expect(() => new Function(BEACON_JS)).not.toThrow();
  });

  it('sends a page_view on load, drains the pre-load queue, and flushes with sendBeacon on pagehide', () => {
    const b = fakeBrowser('https://shop.example/plants?q=mango&utm_source=meta&utm_campaign=Diwali', {
      referrer: 'https://l.instagram.com/some/path?u=1',
      preload: [['add_to_cart', { item_id: 'p1', qty: 2, email: 'a@b.co' }]],
    });
    expect(b.sent).toHaveLength(0); // batched, not sent per event
    b.fire('window', 'pagehide');
    expect(b.sent).toHaveLength(1);
    const batch = beaconBatchSchema.parse(b.sent[0]);
    expect(batch.r).toBe('l.instagram.com');
    const [pv, atc, ttfb] = b.events();
    expect(pv).toMatchObject({ n: 'page_view', p: '/plants?utm_source=meta&utm_campaign=Diwali' });
    expect(atc).toMatchObject({ n: 'add_to_cart', d: { item_id: 'p1', qty: 2 } });
    expect(atc!.d).not.toHaveProperty('email');
    expect(ttfb).toMatchObject({ n: 'web_vital', d: { m: 'TTFB', v: 180 } });
    for (const e of b.events()) expect(beaconEventSchema.safeParse(e).success).toBe(true);
  });

  it('masks emails and phone numbers in prop values and exposes push as the queue API', () => {
    const b = fakeBrowser('https://shop.example/');
    (b.window.__ekq as { push(a: unknown[]): void }).push(['search', { q: 'call 98765 43210 or me@x.in', results: 0 }]);
    b.fire('document', 'visibilitychange');
    expect(b.sent).toHaveLength(0); // still visible
    b.document.hidden = true;
    b.fire('document', 'visibilitychange');
    expect(b.events().find((e) => e.n === 'search')?.d).toEqual({ q: 'call [phone] or [email]', results: 0 });
  });

  it('emits a page_view per client route change (pathname only) and on bfcache restore', () => {
    const b = fakeBrowser('https://shop.example/');
    b.history.pushState(null, '', '/plants');
    b.history.pushState(null, '', '/plants?sort=price'); // same pathname: not a new page
    b.fire('window', 'pageshow', { persisted: true });
    b.fire('window', 'pagehide');
    const views = b.events().filter((e) => e.n === 'page_view');
    expect(views.map((v) => v.p)).toEqual(['/', '/plants', '/plants']);
    expect(views[2]!.d).toEqual({ bf: 1 });
    expect(b.events().find((e) => e.n === 'web_vital')?.p).toBe('/'); // measured on the landing page
  });

  it('detects CTA clicks, rage clicks and dead clicks', () => {
    const b = fakeBrowser('https://shop.example/');
    const cta = new b.Element({ 'data-cta': 'hero-shop-plants' });
    for (let i = 0; i < 3; i++) b.fire('document', 'click', { target: cta, clientX: 100, clientY: 100 });
    for (const t of b.timeouts) t(); // nothing changed within 1 s
    b.fire('window', 'pagehide');
    const names = b.events().map((e) => e.n);
    expect(names.filter((n) => n === 'cta_click')).toHaveLength(3);
    expect(b.events().find((e) => e.n === 'rage_click')?.d).toMatchObject({ s: 'hero-shop-plants' });
    expect(names.filter((n) => n === 'dead_click')).toHaveLength(3);
  });

  it('flushes in batches at 20 events', () => {
    const b = fakeBrowser('https://shop.example/');
    const q = b.window.__ekq as { push(a: unknown[]): void };
    for (let i = 0; i < 19; i++) q.push(['cta_click', { cta: `c${i}` }]);
    expect(b.sent).toHaveLength(1); // page_view + 19 = 20
    expect(b.sent[0]!.e).toHaveLength(20);
  });
});
