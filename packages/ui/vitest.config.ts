import { defineConfig } from 'vitest/config';

// Component tests render in happy-dom; domain tests do not care.
export default defineConfig({ test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'happy-dom' } });
