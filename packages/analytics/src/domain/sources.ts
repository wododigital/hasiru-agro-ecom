import type { Utm } from './privacy';

// Classification data: third-party user-agent tokens and referrer hosts this module must recognise.
// They identify visitors and traffic sources; they are not dependencies of this code.

/** Named agents first (most specific wins), then the generic catch-all. */
const BOTS: readonly (readonly [name: string, re: RegExp])[] = [
  ['Googlebot', /googlebot|google-inspectiontool|storebot-google|adsbot-google|mediapartners-google/i],
  ['Google-Extended', /google-extended/i],
  ['Bingbot', /bingbot|bingpreview|adidxbot/i],
  ['GPTBot', /gptbot|oai-searchbot|chatgpt-user/i],
  ['ClaudeBot', /claudebot|claude-user|claude-searchbot|anthropic-ai/i],
  ['PerplexityBot', /perplexitybot|perplexity-user/i],
  ['Bytespider', /bytespider/i],
  ['CCBot', /ccbot/i],
  ['Applebot', /applebot/i],
  ['Meta', /facebookexternalhit|facebookcatalog|meta-externalagent/i],
  ['WhatsApp preview', /whatsapp/i],
  ['Twitterbot', /twitterbot/i],
  ['LinkedInBot', /linkedinbot/i],
  ['Slackbot', /slackbot/i],
  ['Lighthouse', /lighthouse|chrome-lighthouse|pagespeed/i],
  ['Headless browser', /headlesschrome|phantomjs|puppeteer|playwright|selenium/i],
  ['Other bot', /bot\b|crawler|spider|crawling|scraper|curl\/|wget\/|python-requests|httpclient|go-http-client|axios\//i],
];

/** The bot's display name, or null for a regular browser. An empty user agent counts as a bot. */
export function botName(userAgent: string | null | undefined): string | null {
  if (!userAgent || userAgent.trim().length < 10) return 'Other bot';
  for (const [name, re] of BOTS) if (re.test(userAgent)) return name;
  return null;
}

export type Device = 'mobile' | 'tablet' | 'desktop';

export function deviceOf(userAgent: string | null | undefined): Device {
  const ua = userAgent ?? '';
  if (/ipad|tablet|kindle|silk|playbook|android(?!.*mobile)/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** Assistants whose answers link to sites; a visit from one is the `ai` channel. */
const AI_HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'perplexity.ai',
  'gemini.google.com',
  'bard.google.com',
  'copilot.microsoft.com',
  'claude.ai',
  'chat.deepseek.com',
  'you.com',
  'meta.ai',
  'grok.com',
];
const SEARCH_RE = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|yandex|baidu|startpage|brave)\.[a-z.]+$/;
const SOCIAL_RE = /(^|\.)(facebook|fb|instagram|t|twitter|x|linkedin|lnkd|youtube|youtu|whatsapp|wa|pinterest|reddit|threads|quora|sharechat)\.[a-z.]+$/;

export const CHANNELS = ['direct', 'search', 'social', 'ai', 'referral', 'campaign', 'paid', 'email'] as const;
export type Channel = (typeof CHANNELS)[number];

const hostMatches = (host: string, list: readonly string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

export function isAiReferrer(host: string | null | undefined): boolean {
  return !!host && hostMatches(host.toLowerCase(), AI_HOSTS);
}

/**
 * Channel of a session from its first page: paid click ids and paid mediums first, then other campaign
 * tags, then the referrer host. `siteHost` makes internal referrers count as direct.
 */
export function channelOf(input: { referrerHost: string | null; utm: Utm | null; siteHost?: string | null }): Channel {
  const { utm } = input;
  const host = input.referrerHost?.toLowerCase().replace(/^www\./, '') ?? '';
  if (utm?.paid || /^(cpc|ppc|paid|paidsearch|paid_social|display|cpm)$/.test(utm?.medium ?? '')) return 'paid';
  if (utm?.medium === 'email' || utm?.source === 'newsletter') return 'email';
  if (utm?.source && /(chatgpt|openai|perplexity|gemini|copilot|claude)/.test(utm.source)) return 'ai';
  if (utm?.source || utm?.medium || utm?.campaign) return 'campaign';
  const site = input.siteHost?.toLowerCase().replace(/^www\./, '');
  if (!host || (site && host === site)) return 'direct';
  if (isAiReferrer(host)) return 'ai';
  if (SEARCH_RE.test(host)) return 'search';
  if (SOCIAL_RE.test(host)) return 'social';
  return 'referral';
}
