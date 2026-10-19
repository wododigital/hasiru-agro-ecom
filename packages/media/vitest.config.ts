import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `server-only` throws outside a React Server build; tests import server code directly.
export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)) } },
  test: { include: ['test/**/*.test.{ts,tsx}'], testTimeout: 60_000, hookTimeout: 120_000 },
});
