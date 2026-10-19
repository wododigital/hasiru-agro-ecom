import { connection } from 'next/server';

/**
 * Marks a route handler as per-request (never prerendered at build). Outside a Next request (unit tests, scripts)
 * there is nothing to mark; every other error, including Next's own prerender signals, propagates.
 */
export async function dynamicRequest(): Promise<void> {
  try {
    await connection();
  } catch (err) {
    if (!(err instanceof Error && err.message.includes('outside a request scope'))) throw err;
  }
}
