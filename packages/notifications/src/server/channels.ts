import type { ChannelId, NotificationChannel, OutboundMessage, SendResult } from '@ecomkit/core/contracts';
import { createLogger } from '@ecomkit/core/observability';
import { backoffMs, classifyWhatsappError, whatsappEndpoint, type FailureKind } from '../domain/rules';
import { buildMime, toBase64Url } from '../domain/mime';
import { templatePayload, textPayload } from '../domain/whatsapp';
import type { NotificationsSettings } from '../settings';
import { gmailClient, mockBase, providerHttp, type Http } from './config';

/** A failed send says whether the queue should retry it. */
export interface ChannelResult extends SendResult {
  failure?: FailureKind;
  errorCode?: string | null;
}
export interface Channel extends NotificationChannel {
  send(message: OutboundMessage): Promise<ChannelResult>;
}

export interface ChannelDeps {
  http?: Http;
  sleep?: (ms: number) => Promise<void>;
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const skipped = (): ChannelResult => ({ status: 'skipped_not_configured', providerMessageId: null, error: 'not_configured' });
const failed = (error: string, failure: FailureKind, errorCode: string | null = null): ChannelResult => ({ status: 'failed', providerMessageId: null, error: error.slice(0, 1000), failure, errorCode });

// ---- Gmail API (OAuth refresh token) -------------------------------------------------------
const GOOGLE_HOSTS = ['oauth2.googleapis.com', 'gmail.googleapis.com'];
/** Mock mode needs no Google project: the dev outbox works out of the box. */
const MOCK_GMAIL = { client: { id: 'mock-client', secret: 'mock-secret' }, refreshToken: 'mock-refresh', account: 'outbox@example.test' };

export function gmailEndpoints(mode: string) {
  const base = mode === 'mock' ? mockBase('gmail') : null;
  return {
    auth: base ? `${base}/o/oauth2/v2/auth` : 'https://accounts.google.com/o/oauth2/v2/auth',
    token: base ? `${base}/token` : 'https://oauth2.googleapis.com/token',
    send: base ? `${base}/gmail/v1/users/me/messages/send` : 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
  };
}

export function gmailConfig(s: NotificationsSettings) {
  if (s.emailMode === 'off') return null;
  const mock = s.emailMode === 'mock';
  const client = gmailClient(s) ?? (mock ? MOCK_GMAIL.client : null);
  const refreshToken = s.gmailRefreshToken || (mock ? MOCK_GMAIL.refreshToken : '');
  const account = s.gmailAccount || (mock ? MOCK_GMAIL.account : '');
  return client && refreshToken && account ? { client, refreshToken, account, endpoints: gmailEndpoints(s.emailMode), http: providerHttp(s.emailMode, GOOGLE_HOSTS) } : null;
}

/** Access tokens last an hour; cached per refresh token, dropped on 401. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export const clearGmailTokenCache = () => tokenCache.clear();

async function accessToken(cfg: NonNullable<ReturnType<typeof gmailConfig>>, http: Http): Promise<string> {
  const hit = tokenCache.get(cfg.refreshToken);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const res = await http(cfg.endpoints.token, {
    method: 'POST',
    body: new URLSearchParams({ client_id: cfg.client.id, client_secret: cfg.client.secret, refresh_token: cfg.refreshToken, grant_type: 'refresh_token' }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) throw new GmailRefreshError(json.error ?? `token endpoint ${res.status}`);
  tokenCache.set(cfg.refreshToken, { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}

export class GmailRefreshError extends Error {
  constructor(reason: string) {
    super(`gmail_refresh_failed: ${reason}`);
    this.name = 'GmailRefreshError';
  }
}

export function createGmailChannel(s: NotificationsSettings, deps: ChannelDeps = {}): Channel {
  const sleep = deps.sleep ?? sleepReal;
  return {
    id: 'email',
    adapter: 'gmail',
    async send(m) {
      const cfg = gmailConfig(s);
      if (!cfg) return skipped();
      const http = deps.http ?? cfg.http;
      const raw = toBase64Url(
        buildMime({
          from: cfg.account,
          fromName: s.emailFromName || s.storeName || undefined,
          to: m.to,
          bcc: s.emailBccAdmin && s.adminEmail && s.adminEmail !== m.to ? s.adminEmail : null,
          replyTo: s.emailReplyTo || null,
          subject: m.subject ?? '',
          text: m.text,
          html: m.html,
          messageId: m.messageId,
        }),
      );
      let refreshed = false;
      for (let attempt = 0; ; attempt++) {
        let token: string;
        try {
          token = await accessToken(cfg, http);
        } catch (err) {
          // invalid_grant: the mailbox must be reconnected; retrying will not help.
          return failed(String((err as Error).message), 'permanent', 'gmail_refresh_failed');
        }
        const res = await http(cfg.endpoints.send, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }) });
        const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string; errors?: { reason?: string }[] } };
        if (res.ok && json.id) return { status: 'sent', providerMessageId: json.id, error: null };
        if (res.status === 401 && !refreshed) {
          tokenCache.delete(cfg.refreshToken);
          refreshed = true;
          continue;
        }
        const reason = json.error?.errors?.[0]?.reason ?? '';
        const rateLimited = res.status === 429 || (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(reason));
        if ((rateLimited || res.status >= 500) && attempt < 4) {
          await sleep(backoffMs(attempt));
          continue;
        }
        return failed(`gmail ${res.status}: ${json.error?.message ?? 'send failed'}`, rateLimited || res.status >= 500 ? 'retry' : 'permanent', String(res.status));
      }
    },
  };
}

// ---- WhatsApp Cloud API + Marketing Messages API ------------------------------------------------
const META_HOSTS = ['graph.facebook.com'];
const MOCK_WA = { phoneNumberId: 'mock-phone-id', token: 'mock-token', wabaId: 'mock-waba', appSecret: 'mock-app-secret', verifyToken: 'mock-verify-token' };

export function whatsappConfig(s: NotificationsSettings) {
  if (s.whatsappMode === 'off') return null;
  const mock = s.whatsappMode === 'mock';
  const pick = (value: string | undefined, fallback: string) => value || (mock ? fallback : '');
  const cfg = {
    base: `${mock ? mockBase('meta') : 'https://graph.facebook.com'}/${s.whatsappGraphVersion}`,
    phoneNumberId: pick(s.whatsappPhoneNumberId, MOCK_WA.phoneNumberId),
    wabaId: pick(s.whatsappWabaId, MOCK_WA.wabaId),
    token: pick(s.whatsappToken, MOCK_WA.token),
    appSecret: pick(s.whatsappAppSecret, MOCK_WA.appSecret),
    verifyToken: pick(s.whatsappVerifyToken, MOCK_WA.verifyToken),
    http: providerHttp(s.whatsappMode, META_HOSTS),
  };
  return cfg.phoneNumberId && cfg.token ? cfg : null;
}

/** Graph API call; returns the parsed body or a classified failure. */
export async function graph(cfg: NonNullable<ReturnType<typeof whatsappConfig>>, path: string, init: { method?: string; body?: unknown } = {}, http: Http = cfg.http) {
  const res = await http(`${cfg.base}/${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${cfg.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: number; message?: string } };
  return { ok: res.ok, status: res.status, json };
}

export function createWhatsappChannel(s: NotificationsSettings, deps: ChannelDeps = {}): Channel & { sendText(to: string, body: string): Promise<ChannelResult> } {
  const post = async (path: string, body: unknown): Promise<ChannelResult> => {
    const cfg = whatsappConfig(s);
    if (!cfg) return skipped();
    const r = await graph(cfg, `${cfg.phoneNumberId}/${path}`, { method: 'POST', body }, deps.http);
    const id = (r.json.messages as { id?: string }[] | undefined)?.[0]?.id;
    if (r.ok && id) return { status: 'sent', providerMessageId: id, error: null };
    const code = r.json.error?.code ?? null;
    return failed(`whatsapp ${r.status}: ${r.json.error?.message ?? 'send failed'}`, classifyWhatsappError(code, r.status), code === null ? String(r.status) : String(code));
  };
  return {
    id: 'whatsapp',
    adapter: 'whatsapp-cloud',
    async send(m) {
      if (!m.whatsapp) return failed('message has no WhatsApp template', 'permanent');
      const endpoint = whatsappEndpoint(m.whatsapp.category, s.whatsappMarketingViaMmApi);
      return post(endpoint, templatePayload({ to: m.to, name: m.whatsapp.templateName, language: m.whatsapp.language, category: m.whatsapp.category, params: m.whatsapp.params }));
    },
    sendText: (to, body) => post('messages', textPayload(to, body)),
    async testConnection() {
      const cfg = whatsappConfig(s);
      if (!cfg) return { ok: false, message: 'WhatsApp is off or not configured.' };
      const r = await graph(cfg, `${cfg.phoneNumberId}?fields=display_phone_number,verified_name`, {}, deps.http);
      return r.ok
        ? { ok: true, message: `Connected: ${String(r.json.verified_name ?? '')} ${String(r.json.display_phone_number ?? '')}`.trim() }
        : { ok: false, message: `WhatsApp ${r.status}: ${r.json.error?.message ?? 'request failed'}` };
    },
  };
}

// ---- SMS (log only until sender registration) and log --------------------------------------------
const log = createLogger('notifications');

export function createSmsMockChannel(s: NotificationsSettings): Channel {
  return {
    id: 'sms',
    adapter: 'sms-mock',
    async send(m) {
      if (s.smsMode === 'off') return skipped();
      log.info('sms (mock)', { messageId: m.messageId, templateKey: m.templateKey, chars: m.text.length });
      return { status: 'sent', providerMessageId: `sms-mock-${m.messageId}`, error: null };
    },
  };
}

export const logChannel: Channel = {
  id: 'log',
  adapter: 'log',
  async send(m) {
    log.info('message (log channel)', { messageId: m.messageId, templateKey: m.templateKey, subject: m.subject });
    return { status: 'sent', providerMessageId: `log-${m.messageId}`, error: null };
  },
};

export function channelFor(id: ChannelId, s: NotificationsSettings, deps: ChannelDeps = {}): Channel {
  if (id === 'email') return createGmailChannel(s, deps);
  if (id === 'whatsapp') return createWhatsappChannel(s, deps);
  if (id === 'sms') return createSmsMockChannel(s);
  return logChannel;
}
