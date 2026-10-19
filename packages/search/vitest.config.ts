import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./test/stubs/empty.ts', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    benchmark: { include: ['test/**/*.bench.ts'] },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
