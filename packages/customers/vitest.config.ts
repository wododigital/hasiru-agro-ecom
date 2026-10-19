import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `server-only` throws outside a React server build; tests import the server entry directly.
export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 120_000 },
});
