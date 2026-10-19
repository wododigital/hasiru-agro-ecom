import type { NotificationChannel, NotificationSender } from '@ecomkit/core/contracts';

export interface AuthDeps {
  /** The notifications service, normally `() => registry.service('notifications')` (null when the module is off). */
  notifications?: () => Promise<NotificationSender | null>;
  /** A raw channel used when no sender is available (tests pass `fakeNotificationChannel()`). */
  channel?: NotificationChannel;
  /** Request headers; defaults to `next/headers`. Tests and scripts pass their own. */
  headers?: () => Promise<Headers>;
  /** Origin the auth cookies and links belong to; defaults to SITE_URL, then http://localhost:3000. */
  baseURL?: string;
  /** Issuer shown in authenticator apps. */
  appName?: string;
}

// Kept on globalThis so the instrumentation bundle and the route bundles share one configuration.
const KEY = Symbol.for('ecomkit.auth');
type Store = { deps: AuthDeps; instance: unknown };
const store: Store = ((globalThis as Record<symbol, unknown>)[KEY] as Store | undefined) ?? { deps: {}, instance: null };
(globalThis as Record<symbol, unknown>)[KEY] = store;

/** Called once at boot by the app (instrumentation `register()`), and by tests. Rebuilds the auth instance. */
export function configureAuth(deps: AuthDeps): void {
  store.deps = { ...store.deps, ...deps };
  store.instance = null;
}

export function authDeps(): AuthDeps {
  return store.deps;
}

export function cachedInstance<T>(build: () => T): T {
  store.instance ??= build();
  return store.instance as T;
}

export function baseURL(): string {
  return store.deps.baseURL || process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

export async function requestHeaders(): Promise<Headers> {
  if (store.deps.headers) return store.deps.headers();
  const [{ headers }, { connection }] = await Promise.all([import('next/headers'), import('next/server')]);
  // Sessions are per request and read the clock (expiry, 12 h staff limit): never part of a prerender or runtime prefetch.
  await connection();
  return new Headers(await headers());
}

/** nginx sets x-real-ip; x-forwarded-for is the fallback for other proxies. */
export function clientIp(headers: Headers): string | null {
  return headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}
