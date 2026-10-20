import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Server code starts with `import 'server-only'`, which throws outside a React server build; tests stub it.
// Files share nothing (each creates its own database), and merge tests need real transactions.
export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'node', testTimeout: 30_000, hookTimeout: 120_000 },
});
