import { describe, expect, it } from 'vitest';
import {
  botName,
  channelOf,
  cleanPath,
  deviceOf,
  funnelCounts,
  isPartitionExpired,
  parseBatch,
  partitionsToEnsure,
  pathKey,
  previousRange,
  scrubProps,
  startsNewSession,
  vitalRating,
  delta,
} from '../src/domain';
import { ev } from './helpers';

const at = (iso: string) => new Date(iso);

describe('payload', () => {
  it('keeps valid events and drops unknown names and malformed ones without failing the batch', () => {
    const parsed = parseBatch({ e: [ev('page_view', '/'), ev('made_up', '/'), { i: 'x', n: 'page_view', p: '/', t: 1 }], r: 'WWW.Google.com' });
    expect(parsed?.events.map((e) => e.n)).toEqual(['page_view']);
    expect(parsed?.rejected).toBe(2);
    expect(parsed?.referrerHost).toBe('www.google.com');
  });

  it('rejects an envelope that is not a batch or is too large', () => {
    expect(parseBatch({})).toBeNull();
    expect(parseBatch({ e: [] })).toBeNull();
    expect(parseBatch({ e: Array.from({ length: 51 }, () => ev('page_view')) })).toBeNull();
  });
});

describe('privacy', () => {
  it('keeps only campaign params and strips everything else from the path', () => {
    expect(cleanPath('/plants?q=mango&utm_source=News&utm_campaign=Diwali&token=abc')).toEqual({ path: '/plants', utm: { source: 'news', campaign: 'diwali' } });
    expect(cleanPath('/p?gclid=123')).toEqual({ path: '/p', utm: { paid: true } });
    expect(cleanPath('/u/a@b.co').path).not.toContain('@');
  });

  it('drops personal-data keys and masks emails and phone numbers in values', () => {
    expect(scrubProps({ email: 'a@b.co', phone_number: '9876543210', label: 'Call 98765 43210 or a@b.co', qty: 2 })).toEqual({ label: 'Call [phone] or [email]', qty: 2 });
  });
});

describe('sources', () => {
  it('classifies bots, AI crawlers and browsers', () => {
    expect(botName('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe('Googlebot');
    expect(botName('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)')).toBe('GPTBot');
    expect(botName('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/130.0 Safari/537.36')).toBe('Headless browser');
    expect(botName('')).toBe('Other bot');
    expect(botName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBeNull();
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Safari/537.36')).toBe('tablet');
  });

  it('assigns channels: paid, campaign, AI assistants, search, social, internal as direct', () => {
    expect(channelOf({ referrerHost: 'www.google.com', utm: { paid: true } })).toBe('paid');
    expect(channelOf({ referrerHost: null, utm: { source: 'newsletter' } })).toBe('email');
    expect(channelOf({ referrerHost: null, utm: { source: 'chatgpt.com' } })).toBe('ai');
    expect(channelOf({ referrerHost: 'chatgpt.com', utm: null })).toBe('ai');
    expect(channelOf({ referrerHost: 'www.perplexity.ai', utm: null })).toBe('ai');
    expect(channelOf({ referrerHost: 'www.google.co.in', utm: null })).toBe('search');
    expect(channelOf({ referrerHost: 'l.instagram.com', utm: null })).toBe('social');
    expect(channelOf({ referrerHost: 'shop.example.com', utm: null, siteHost: 'shop.example.com' })).toBe('direct');
    expect(channelOf({ referrerHost: 'blog.example.org', utm: null })).toBe('referral');
  });
});

describe('sessions', () => {
  const prev = { lastEventAt: at('2026-10-20T10:00:00+05:30'), utm: null };
  it('splits after 30 idle minutes, at IST midnight and on a new campaign', () => {
    expect(startsNewSession(null, at('2026-10-20T10:00:00+05:30'), null)).toBe(true);
    expect(startsNewSession(prev, at('2026-10-20T10:29:59+05:30'), null)).toBe(false);
    expect(startsNewSession(prev, at('2026-10-20T10:30:01+05:30'), null)).toBe(true);
    expect(startsNewSession({ lastEventAt: at('2026-10-20T23:55:00+05:30'), utm: null }, at('2026-10-21T00:05:00+05:30'), null)).toBe(true);
    expect(startsNewSession(prev, at('2026-10-20T10:05:00+05:30'), { source: 'meta', campaign: 'diwali' })).toBe(true);
    expect(startsNewSession({ ...prev, utm: { source: 'meta', campaign: 'diwali' } }, at('2026-10-20T10:05:00+05:30'), { source: 'meta', campaign: 'diwali' })).toBe(false);
  });
});

describe('partition maths', () => {
  it('ensures the current month and the next two', () => {
    expect(partitionsToEnsure(at('2026-10-25T02:00:00+05:30')).map((p) => p.name)).toEqual(['analytics_event_2026_10', 'analytics_event_2026_11', 'analytics_event_2026_12']);
    expect(partitionsToEnsure(at('2026-12-25T00:00:00Z')).map((p) => p.name)).toEqual(['analytics_event_2026_12', 'analytics_event_2027_01', 'analytics_event_2027_02']);
  });

  it('on the 25th, month-4 is past 90 days and month-3 is not', () => {
    const run = at('2026-10-25T02:00:00+05:30');
    expect(isPartitionExpired('analytics_event_2026_06', run)).toBe(true);
    expect(isPartitionExpired('analytics_event_2026_07', run)).toBe(false);
    expect(isPartitionExpired('analytics_event_default', run)).toBe(false);
  });
});

describe('report maths', () => {
  it('counts a funnel step only when every earlier step came first', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 9, 20, 5, m));
    const rows = [
      { sessionId: 'a', name: 'page_view', at: t(0) },
      { sessionId: 'a', name: 'view_item', at: t(1) },
      { sessionId: 'a', name: 'add_to_cart', at: t(2) },
      { sessionId: 'b', name: 'page_view', at: t(0) },
      { sessionId: 'b', name: 'add_to_cart', at: t(1) }, // skipped view_item
      { sessionId: 'c', name: 'view_item', at: t(0) },
      { sessionId: 'c', name: 'page_view', at: t(5) }, // out of order
    ];
    expect(funnelCounts(rows)).toEqual([3, 1, 1, 0, 0, 0]);
  });

  it('builds path keys, previous ranges, deltas and vital ratings', () => {
    expect(pathKey(['/', '/', '/plants', '/p/mango', '/cart', '/checkout'])).toBe('/ → /plants → /p/mango → /cart');
    expect(previousRange({ from: '2026-10-01', to: '2026-10-07' })).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(delta(15, 10)).toBe(0.5);
    expect(delta(3, 0)).toBeNull();
    expect(vitalRating('LCP', 2400)).toBe('good');
    expect(vitalRating('INP', 300)).toBe('needs-improvement');
    expect(vitalRating('CLS', 0.3)).toBe('poor');
  });
});
