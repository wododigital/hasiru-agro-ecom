// Mock Google OAuth + Gmail API for dev and test. Route: /api/_mock/gmail/[...path]. 404 unless ENABLE_MOCKS=1.
import { newId } from '@ecomkit/core/ids';
import { fromBase64Url, parseMime, type ParsedMail } from '../domain/mime';

export interface GmailMockMail extends ParsedMail {
  id: string;
  at: string;
}
interface GmailMockState {
  outbox: GmailMockMail[];
  /** Fail the next `times` sends with this status (401 expired token, 429 rate limit). */
  fail: { status: 401 | 429; times: number } | null;
  /** Refresh tokens Google has revoked (invalid_grant). */
  revoked: Set<string>;
  tokens: Set<string>;
  tokenRequests: number;
}

const g = globalThis as unknown as { __ecomkitGmailMock?: GmailMockState };
export const gmailMockState = (): GmailMockState => (g.__ecomkitGmailMock ??= { outbox: [], fail: null, revoked: new Set(), tokens: new Set(), tokenRequests: 0 });
export const resetGmailMock = () => void delete g.__ecomkitGmailMock;

const enabled = () => process.env.ENABLE_MOCKS === '1';
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function handle(req: Request): Promise<Response> {
  if (!enabled()) return new Response(null, { status: 404 });
  const url = new URL(req.url);
  const path = url.pathname.split('/api/_mock/gmail/')[1] ?? '';
  const state = gmailMockState();

  if (path === '_control' && req.method === 'POST') {
    const json = (await req.json().catch(() => ({}))) as { fail?: 401 | 429 | null; times?: number; revoke?: string };
    if ('fail' in json) state.fail = json.fail ? { status: json.fail, times: json.times ?? 1 } : null;
    if (json.revoke) state.revoked.add(json.revoke);
    return Response.json({ ok: true });
  }
  if (path === '_state') return Response.json({ outbox: state.outbox, tokenRequests: state.tokenRequests });

  // Consent screen: approves at once and returns to our callback with a code.
  if (path === 'o/oauth2/v2/auth') {
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', `mock-code-${newId()}`);
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    return Response.redirect(back.toString(), 302);
  }

  if (path === 'token' && req.method === 'POST') {
    state.tokenRequests++;
    const form = new URLSearchParams(await req.text());
    if (form.get('grant_type') === 'authorization_code') {
      if (!form.get('code')?.startsWith('mock-code-')) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const access = `mock-access-${newId()}`;
      state.tokens.add(access);
      return Response.json({ access_token: access, expires_in: 3599, refresh_token: `mock-refresh-${newId()}`, id_token: `${b64url({ alg: 'none' })}.${b64url({ email: 'shop@example.test' })}.`, token_type: 'Bearer' });
    }
    const refresh = form.get('refresh_token') ?? '';
    if (!refresh || state.revoked.has(refresh)) return Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 });
    const access = `mock-access-${newId()}`;
    state.tokens.add(access);
    return Response.json({ access_token: access, expires_in: 3599, token_type: 'Bearer' });
  }

  if (path === 'gmail/v1/users/me/messages/send' && req.method === 'POST') {
    const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (state.fail && state.fail.times > 0) {
      state.fail.times--;
      const status = state.fail.status;
      if (status === 401) state.tokens.delete(token);
      return status === 401
        ? Response.json({ error: { code: 401, message: 'Request had invalid authentication credentials.' } }, { status: 401 })
        : Response.json({ error: { code: 429, message: 'User-rate limit exceeded', errors: [{ reason: 'rateLimitExceeded' }] } }, { status: 429 });
    }
    if (!state.tokens.has(token)) return Response.json({ error: { code: 401, message: 'Request had invalid authentication credentials.' } }, { status: 401 });
    const { raw } = (await req.json().catch(() => ({}))) as { raw?: string };
    if (!raw) return Response.json({ error: { code: 400, message: 'raw is required' } }, { status: 400 });
    const id = `mock-${newId()}`;
    state.outbox.unshift({ id, at: new Date().toISOString(), ...parseMime(fromBase64Url(raw)) });
    state.outbox.length = Math.min(state.outbox.length, 200);
    return Response.json({ id, threadId: id, labelIds: ['SENT'] });
  }
  return new Response(null, { status: 404 });
}

export const GET = handle;
export const POST = handle;
