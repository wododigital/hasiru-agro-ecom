import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `server-only` throws outside a React server build; tests import server modules directly, so it is stubbed.
export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 120_000 },
});
