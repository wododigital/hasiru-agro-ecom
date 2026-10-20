// Server errors from every route go to core observability (fingerprint, core_error_issue, alerts).
export { onRequestError } from '@ecomkit/core/observability';

/** Binds every module's ports once per server process (Node runtime only; the proxy runs without them). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { boot } = await import('./src/boot');
  await boot();
}
