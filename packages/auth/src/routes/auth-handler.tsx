import { PUBLIC_AUTH_PATHS } from '../domain';
import { getAuth } from '../server/auth';

/**
 * /api/auth/[...all]. Only session read and sign-out are reachable over HTTP. Sign-in, codes, invites and 2FA run
 * through this package's server functions, which carry the rate limits, lockout and generic answers; the raw Better
 * Auth routes (password sign-up, plaintext phone codes, admin endpoints) answer 404.
 */
async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, '').replace(/\/+$/, '') || '/';
  if (!PUBLIC_AUTH_PATHS.includes(path)) return new Response('Not Found', { status: 404 });
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
