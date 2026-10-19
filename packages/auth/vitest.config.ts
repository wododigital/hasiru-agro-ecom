import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Server tests run in plain Node: `server-only` is swapped for an empty module (it throws outside the react-server condition).
export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 120_000 },
});
