/**
 * CSRF guard for cookie-authenticated route handlers (server actions get Next's own Origin check; route
 * handlers do not). Browsers send Sec-Fetch-Site on every request and Origin on every cross-site POST.
 * Fails closed when neither is present.
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
