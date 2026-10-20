import { defineConfig } from 'vitest/config';

// These tests spawn real processes (tsx, eslint, the seed steps) and share the machine with the other agents' builds.
export default defineConfig({
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'node', testTimeout: 120_000, hookTimeout: 120_000 },
});
