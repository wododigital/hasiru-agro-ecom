// Server errors from every route go to core observability.
export { onRequestError } from '@ecomkit/core/observability';

/** Binds the enabled modules' ports once per server process (Node runtime only). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { boot } = await import('./src/boot');
  await boot();
}
