import 'server-only';
// Route handlers for /api/plan/generate and /api/plan/unlock. Both accept JSON (the islands) and plain form posts
// (no JavaScript: answer 303 back to a page), check same-origin first and cap the body.
import { getViewer } from '@ecomkit/core/auth-context';
import { clientIp, isSameOrigin, PayloadTooLargeError, readRawBody } from '@ecomkit/core/http';
import { newId } from '@ecomkit/core/ids';
import { generatePlan, PlanInputError, unlockPlan } from './plans';

const MAX_BODY = 8 * 1024;
const VISITOR_COOKIE = 'plan_visitor';
const VISITOR_RE = /^[0-9a-f-]{36}$/;

async function readBody(req: Request): Promise<{ form: boolean; data: Record<string, unknown> }> {
  const form = !(req.headers.get('content-type') ?? '').includes('application/json');
  const raw = (await readRawBody(req, MAX_BODY)).toString('utf8');
  if (form) return { form, data: Object.fromEntries(new URLSearchParams(raw)) };
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  return { form, data: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {} };
}

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const secure = () => ((process.env.SITE_URL ?? '').startsWith('https://') ? '; Secure' : '');

function redirect(req: Request, path: string, status = 303): Response {
  return new Response(null, { status, headers: { location: new URL(path, req.url).toString() } });
}

const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers });

export async function handleGenerate(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);
  let body: Awaited<ReturnType<typeof readBody>>;
  try {
    body = await readBody(req);
  } catch (err) {
    return json({ error: err instanceof PayloadTooLargeError ? 'too_large' : 'invalid' }, err instanceof PayloadTooLargeError ? 413 : 400);
  }
  const existing = cookieValue(req, VISITOR_COOKIE);
  const visitorId = existing && VISITOR_RE.test(existing) ? existing : newId();
  const viewer = await getViewer();
  try {
    const { planId } = await generatePlan(body.data, { visitorId, customerId: viewer.kind === 'customer' ? viewer.customerId : null, ip: clientIp(req) });
    const url = `/plan/results/${planId}`;
    const res = body.form ? redirect(req, url) : json({ planId, url });
    res.headers.append('set-cookie', `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure()}`);
    // The catalog reads `district` for fit chips across the shop.
    res.headers.append('set-cookie', `district=${encodeURIComponent(String(body.data.district))}; Path=/; Max-Age=15552000; SameSite=Lax${secure()}`);
    return res;
  } catch (err) {
    if (!(err instanceof PlanInputError)) throw err;
    if (body.form) return redirect(req, `/plan?error=${err.field}`);
    return json({ error: err.field }, err.field === 'limited' ? 429 : 400);
  }
}

export async function handleUnlock(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403);
  let body: Awaited<ReturnType<typeof readBody>>;
  try {
    body = await readBody(req);
  } catch {
    return json({ status: 'invalid' }, 400);
  }
  const result = await unlockPlan(body.data, { ip: clientIp(req), requestHeaders: req.headers });
  const planId = typeof body.data.planId === 'string' && VISITOR_RE.test(body.data.planId) ? body.data.planId : null;
  const status = result.status === 'unlocked' || result.status === 'sent' ? 200 : result.status === 'limited' ? 429 : result.status === 'not_found' ? 404 : 400;
  const res = body.form && planId ? redirect(req, `/plan/results/${planId}${result.status === 'unlocked' ? '' : `?unlock=${result.status}`}`) : json({ status: result.status }, status);
  // OTP mode: carry the new session cookie from the auth module.
  for (const c of result.headers?.getSetCookie() ?? []) res.headers.append('set-cookie', c);
  return res;
}
