import { randomBytes } from 'node:crypto';
import type { SettingsActionResult } from '@ecomkit/core/contracts';
import { ForbiddenError, requirePermission } from '@ecomkit/core/auth-context';
import { integrationCall, signInternal, verifyInternal } from '@ecomkit/core/http';
import { fromBase64Url } from '../domain/mime';
import { clearGmailTokenCache, gmailConfig, gmailEndpoints } from './channels';
import { gmailClient, loadSettings, providerHttp, publicOrigin, updateSettings, type Http } from './config';

export const GMAIL_CALLBACK_PATH = '/api/auth/gmail/callback';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send openid email';
const STATE_TTL_MS = 10 * 60_000;
const SETTINGS_PATH = '/admin/settings/notifications';

const redirectUri = () => `${publicOrigin()}${GMAIL_CALLBACK_PATH}`;

function mockAwareClient(mode: string, s: Parameters<typeof gmailClient>[0]) {
  return gmailClient(s) ?? (mode === 'mock' ? { id: 'mock-client', secret: 'mock-secret' } : null);
}

/** State = payload.signature; payload binds the admin who clicked and a timestamp. */
export function signState(actorId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ a: actorId, t: now, n: randomBytes(8).toString('hex') })).toString('base64url');
  return `${payload}.${signInternal(payload, 'gmail-oauth')}`;
}

export function readState(state: string, now = Date.now()): { actorId: string } | null {
  const [payload = '', sig = ''] = state.split('.');
  if (!verifyInternal(payload, sig, 'gmail-oauth')) return null;
  try {
    const data = JSON.parse(fromBase64Url(payload)) as { a?: string; t?: number };
    if (!data.a || !data.t || now - data.t > STATE_TTL_MS || data.t > now + 60_000) return null;
    return { actorId: data.a };
  } catch {
    return null;
  }
}

/** Settings action "Connect Gmail" (oauth-redirect): Google consent for gmail.send, offline access. */
export async function connectGmailAction(ctx: { actorId: string }): Promise<SettingsActionResult> {
  const s = await loadSettings();
  if (s.emailMode === 'off') return { ok: false, message: 'Email is off. Choose mock or live first.' };
  const client = mockAwareClient(s.emailMode, s);
  if (!client) return { ok: false, message: 'No OAuth client: set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET on the server, or enter a client here.' };
  const url = new URL(gmailEndpoints(s.emailMode).auth);
  url.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: signState(ctx.actorId),
  }).toString();
  return { ok: true, message: 'Opening Google to connect the mailbox.', redirectUrl: url.toString() };
}

const back = (query: string) => Response.redirect(new URL(`${SETTINGS_PATH}?${query}`, publicOrigin()), 303);

/**
 * GET /api/auth/gmail/callback: checks the signed state and that the same admin is signed in with
 * settings.secrets, exchanges the code, stores the refresh token (encrypted) and the mailbox address.
 */
export async function gmailCallback(req: Request, deps: { http?: Http } = {}): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return back(`gmail=denied`);
  const code = url.searchParams.get('code');
  const state = readState(url.searchParams.get('state') ?? '');
  if (!code || !state) return new Response('Invalid or expired request. Start again from the settings page.', { status: 400 });
  try {
    const viewer = await requirePermission('settings.secrets');
    if (viewer.userId !== state.actorId) return new Response(null, { status: 403 });
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response(null, { status: 403 });
    throw err;
  }
  const s = await loadSettings();
  const client = mockAwareClient(s.emailMode, s);
  if (!client || s.emailMode === 'off') return back('gmail=not_configured');
  const http = deps.http ?? providerHttp(s.emailMode, ['oauth2.googleapis.com']);
  const call = await integrationCall('gmail', 'oauth.exchange', async () => {
    const res = await http(gmailEndpoints(s.emailMode).token, {
      method: 'POST',
      body: new URLSearchParams({ code, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
    });
    const json = (await res.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; error?: string };
    if (!res.ok || !json.refresh_token) throw new Error(`token exchange failed: ${json.error ?? res.status}${res.ok ? ' (no refresh token; revoke access and connect again)' : ''}`);
    // The id_token comes straight from Google's token endpoint over TLS, so its claims are read without re-verifying.
    const claims = JSON.parse(fromBase64Url(json.id_token?.split('.')[1] ?? 'e30')) as { email?: string };
    return { refreshToken: json.refresh_token, email: claims.email ?? '' };
  });
  if (call.status !== 'ok') return back('gmail=failed');
  await updateSettings({ gmailRefreshToken: call.value.refreshToken, gmailAccount: call.value.email }, { actorId: state.actorId });
  clearGmailTokenCache();
  return back('gmail=connected');
}

/** For the settings panel: which mailbox sends and whether it is usable. */
export async function gmailStatus(): Promise<{ mode: string; account: string | null; connected: boolean }> {
  const s = await loadSettings();
  return { mode: s.emailMode, account: s.gmailAccount || null, connected: gmailConfig(s) !== null };
}
