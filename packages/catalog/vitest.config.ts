import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Server code imports 'server-only', which throws outside a React Server bundle; tests stub it.
export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'node', testTimeout: 60_000, hookTimeout: 120_000 },
});
